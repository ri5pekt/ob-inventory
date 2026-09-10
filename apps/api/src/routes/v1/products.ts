import type { FastifyPluginAsync } from 'fastify'
import { eq, and, ilike, or, inArray, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db.js'
import {
  products, brands, categories,
  productAttributes, attributeDefinitions, attributeOptions,
  inventoryStock, inventoryLedger, warehouses,
} from '@ob-inventory/db'
import { isValidUuid } from './_util.js'
import { enqueueSyncWooStock } from '../../queue.js'
import { downloadAndStoreProductImage } from '../../lib/product-image.js'
import { upsertAttributes } from '../warehouse-products.js'

const listQuerySchema = z.object({
  sku:          z.string().optional(),
  brandId:      z.string().uuid().optional(),
  categoryId:   z.string().uuid().optional(),
  search:       z.string().optional(),
  updatedSince: z.string().datetime().optional(),
  limit:        z.coerce.number().int().min(1).max(1000).default(100),
  offset:       z.coerce.number().int().min(0).default(0),
})

async function attachAttributes<T extends { id: string }>(rows: T[]) {
  if (rows.length === 0) return rows.map(r => ({ ...r, attributes: [] as { name: string; value: string | number | null; code: string | null }[] }))
  const ids = rows.map(r => r.id)
  const attrs = await db
    .select({
      productId:   productAttributes.productId,
      name:        attributeDefinitions.name,
      valueText:   productAttributes.valueText,
      valueNumber: productAttributes.valueNumber,
      optionCode:  attributeOptions.code,
      optionLabel: attributeOptions.label,
    })
    .from(productAttributes)
    .innerJoin(attributeDefinitions, eq(productAttributes.definitionId, attributeDefinitions.id))
    .leftJoin(attributeOptions, eq(productAttributes.optionId, attributeOptions.id))
    .where(inArray(productAttributes.productId, ids))

  const byProduct = new Map<string, { name: string; value: string | number | null; code: string | null }[]>()
  for (const a of attrs) {
    if (!byProduct.has(a.productId)) byProduct.set(a.productId, [])
    byProduct.get(a.productId)!.push({
      name:  a.name,
      value: a.optionLabel ?? a.valueText ?? a.valueNumber ?? null,
      code:  a.optionCode ?? null,
    })
  }

  return rows.map(r => ({ ...r, attributes: byProduct.get(r.id) ?? [] }))
}

/** Shared by GET /:id, and the POST/PUT responses below, so a create/update call
 *  gets back exactly the same shape a follow-up GET would return. */
async function fetchProductDetail(id: string) {
  const [product] = await db
    .select({
      id:           products.id,
      sku:          products.sku,
      name:         products.name,
      brandId:      products.brandId,
      brandName:    brands.name,
      categoryId:   products.categoryId,
      categoryName: categories.name,
      basePrice:    products.basePrice,
      costPrice:    products.costPrice,
      retailPrice:  products.retailPrice,
      wooProductId: products.wooProductId,
      picture:      products.picture,
      notes:        products.notes,
      createdAt:    products.createdAt,
      updatedAt:    products.updatedAt,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.id, id))
  if (!product) return null

  const [withAttrs] = await attachAttributes([product])

  const stock = await db
    .select({ warehouseId: inventoryStock.warehouseId, quantity: inventoryStock.quantity, boxNumber: inventoryStock.boxNumber })
    .from(inventoryStock)
    .where(eq(inventoryStock.productId, id))

  return { ...withAttrs, stock }
}

// ── Write-side helpers ───────────────────────────────────────────────────────
// Agents supply human-readable text (brand/category names, size/color/unit
// labels) rather than internal UUIDs — the internal admin UI passes UUIDs
// straight from dropdowns, but an external agent has no dropdown to read from.
// These resolve by case-insensitive name/label match, auto-creating the
// brand/category/option if it doesn't exist yet (per user decision — favors
// fewer round-trips for agents over rejecting typos).

async function resolveBrandId(name: string | null | undefined): Promise<string | null> {
  if (!name?.trim()) return null
  const trimmed = name.trim()
  const [existing] = await db.select().from(brands).where(ilike(brands.name, trimmed))
  if (existing) return existing.id
  const [created] = await db.insert(brands).values({ name: trimmed }).returning()
  return created.id
}

async function resolveCategoryId(name: string | null | undefined): Promise<string | null> {
  if (!name?.trim()) return null
  const trimmed = name.trim()
  const [existing] = await db.select().from(categories).where(ilike(categories.name, trimmed))
  if (existing) return existing.id
  const [created] = await db.insert(categories).values({ name: trimmed }).returning()
  return created.id
}

/** definitionName is matched case-insensitively against attribute_definitions.name (e.g. 'size', 'color', 'unit'). */
async function resolveAttributeOptionId(definitionName: string, label: string | null | undefined): Promise<string | null> {
  if (!label?.trim()) return null
  const trimmed = label.trim()

  const [def] = await db.select().from(attributeDefinitions).where(ilike(attributeDefinitions.name, definitionName))
  if (!def) return null // definition doesn't exist — nothing sensible to attach to, skip silently

  const [existing] = await db.select().from(attributeOptions)
    .where(and(eq(attributeOptions.definitionId, def.id), ilike(attributeOptions.label, trimmed)))
  if (existing) return existing.id

  const [{ maxSort }] = await db.select({ maxSort: sql<number>`coalesce(max(${attributeOptions.sortOrder}), 0)` })
    .from(attributeOptions).where(eq(attributeOptions.definitionId, def.id))
  const code = trimmed.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || trimmed

  try {
    const [created] = await db.insert(attributeOptions)
      .values({ definitionId: def.id, code, label: trimmed, sortOrder: Number(maxSort) + 1 })
      .returning()
    return created.id
  } catch {
    // Unique (definitionId, code) collision — a different label normalized to the
    // same code (e.g. two labels differing only in punctuation). Reuse it.
    const [byCode] = await db.select().from(attributeOptions)
      .where(and(eq(attributeOptions.definitionId, def.id), eq(attributeOptions.code, code)))
    return byCode?.id ?? null
  }
}

const createProductSchema = z.object({
  sku:          z.string().min(1),
  name:         z.string().min(1),
  wooTitle:     z.string().nullable().optional(),
  brand:        z.string().nullable().optional(),   // resolved by name, auto-created if new
  category:     z.string().nullable().optional(),   // resolved by name, auto-created if new
  model:        z.string().nullable().optional(),   // free text attribute
  size:         z.string().nullable().optional(),    // resolved by label, auto-created if new
  color:        z.string().nullable().optional(),    // resolved by label, auto-created if new
  unit:         z.string().nullable().optional(),     // resolved by label, auto-created if new
  costPrice:    z.number().nonnegative().nullable().optional(),
  retailPrice:  z.number().nonnegative().nullable().optional(),
  notes:        z.string().nullable().optional(),
  imageUrl:     z.string().url().nullable().optional(), // fetched, resized, and stored server-side
  initialStock: z.object({
    warehouseId: z.string().uuid(),
    quantity:    z.number().int().min(0).default(0),
    boxNumber:   z.string().nullable().optional(),
  }).nullable().optional(),
})

const updateProductSchema = z.object({
  sku:         z.string().min(1).optional(),
  name:        z.string().min(1).optional(),
  wooTitle:    z.string().nullable().optional(),
  brand:       z.string().nullable().optional(),
  category:    z.string().nullable().optional(),
  model:       z.string().nullable().optional(),
  size:        z.string().nullable().optional(),
  color:       z.string().nullable().optional(),
  unit:        z.string().nullable().optional(),
  costPrice:   z.number().nonnegative().nullable().optional(),
  retailPrice: z.number().nonnegative().nullable().optional(),
  notes:       z.string().nullable().optional(),
  imageUrl:    z.string().url().nullable().optional(), // null clears the image
})

const setStockSchema = z.object({
  warehouseId: z.string().uuid(),
  quantity:    z.number().int().min(0), // absolute on-hand quantity, not a delta
  boxNumber:   z.string().nullable().optional(),
})

export const productsV1Routes: FastifyPluginAsync = async (fastify) => {
  // ── List products ────────────────────────────────────────────────────────────
  fastify.get('/api/v1/products', async (request, reply) => {
    const q = listQuerySchema.safeParse((request as { query: unknown }).query)
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: q.error.flatten() })
    const f = q.data

    const filters: ReturnType<typeof eq>[] = []
    if (f.sku)          filters.push(eq(products.sku, f.sku))
    if (f.brandId)      filters.push(eq(products.brandId, f.brandId))
    if (f.categoryId)   filters.push(eq(products.categoryId, f.categoryId))
    if (f.updatedSince) filters.push(gte(products.updatedAt, new Date(f.updatedSince)) as ReturnType<typeof eq>)
    if (f.search) {
      const term = f.search.trim()
      filters.push(or(ilike(products.sku, `%${term}%`), ilike(products.name, `%${term}%`)) as ReturnType<typeof eq>)
    }
    const where = filters.length > 0 ? and(...filters) : undefined

    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(products).where(where)

    const rows = await db
      .select({
        id:           products.id,
        sku:          products.sku,
        name:         products.name,
        brandId:      products.brandId,
        brandName:    brands.name,
        categoryId:   products.categoryId,
        categoryName: categories.name,
        basePrice:    products.basePrice,
        costPrice:    products.costPrice,
        retailPrice:  products.retailPrice,
        wooProductId: products.wooProductId,
        picture:      products.picture,
        notes:        products.notes,
        createdAt:    products.createdAt,
        updatedAt:    products.updatedAt,
      })
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(where)
      .orderBy(products.sku)
      .limit(f.limit)
      .offset(f.offset)

    const data = await attachAttributes(rows)

    return { data, pagination: { limit: f.limit, offset: f.offset, total: Number(total) } }
  })

  // ── Single product, with per-warehouse stock ────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/v1/products/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) return reply.status(400).send({ error: 'Invalid id', code: 'VALIDATION_ERROR' })
    const detail = await fetchProductDetail(request.params.id)
    if (!detail) return reply.status(404).send({ error: 'Product not found', code: 'NOT_FOUND' })
    return { data: detail }
  })

  // ── Create product ──────────────────────────────────────────────────────────
  fastify.post('/api/v1/products', async (request, reply) => {
    const body = createProductSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: body.error.flatten() })
    const d = body.data

    const [existing] = await db.select({ id: products.id }).from(products).where(eq(products.sku, d.sku))
    if (existing) return reply.status(409).send({ error: `SKU "${d.sku}" already exists`, code: 'DUPLICATE_SKU' })

    let warehouse: { id: string; type: string } | undefined
    if (d.initialStock) {
      [warehouse] = await db.select({ id: warehouses.id, type: warehouses.type }).from(warehouses)
        .where(eq(warehouses.id, d.initialStock.warehouseId))
      if (!warehouse) return reply.status(404).send({ error: 'initialStock.warehouseId not found', code: 'NOT_FOUND' })
    }

    let picturePath: string | null = null
    if (d.imageUrl) {
      const img = await downloadAndStoreProductImage(d.imageUrl, d.sku)
      if (!img.ok) return reply.status(400).send({ error: img.error, code: 'IMAGE_FETCH_FAILED' })
      picturePath = img.path
    }

    const [brandId, categoryId, sizeOptionId, colorOptionId, unitOptionId] = await Promise.all([
      resolveBrandId(d.brand),
      resolveCategoryId(d.category),
      resolveAttributeOptionId('size', d.size),
      resolveAttributeOptionId('color', d.color),
      resolveAttributeOptionId('unit', d.unit),
    ])

    const [product] = await db.insert(products).values({
      sku:         d.sku,
      name:        d.name,
      wooTitle:    d.wooTitle ?? null,
      brandId,
      categoryId,
      costPrice:   d.costPrice   != null ? String(d.costPrice)   : null,
      retailPrice: d.retailPrice != null ? String(d.retailPrice) : null,
      notes:       d.notes ?? null,
      picture:     picturePath,
      createdBy:   request.apiToken?.createdBy ?? null,
    }).returning()

    await upsertAttributes(product.id, { model: d.model, sizeOptionId, colorOptionId, unitOptionId })

    if (d.initialStock && warehouse) {
      await db.insert(inventoryStock).values({
        productId:  product.id,
        warehouseId: warehouse.id,
        boxNumber:  d.initialStock.boxNumber ?? null,
        quantity:   d.initialStock.quantity,
        dateAdded:  sql`CURRENT_DATE`,
      })
      if (d.initialStock.quantity > 0) {
        await db.insert(inventoryLedger).values({
          productId:     product.id,
          warehouseId:   warehouse.id,
          actionType:    'receive',
          quantityDelta: d.initialStock.quantity,
          notes:         `Created via API token "${request.apiToken?.name ?? 'unknown'}"`,
        })
      }
      if (warehouse.type === 'main') {
        try {
          await enqueueSyncWooStock(product.id)
        } catch (err) {
          request.log.warn({ err, productId: product.id }, '[api/v1] Failed to enqueue Woo sync after product creation')
        }
      }
    }

    const detail = await fetchProductDetail(product.id)
    return reply.status(201).send({ data: detail })
  })

  // ── Update product ───────────────────────────────────────────────────────────
  // Catalog fields only — for stock, use PUT /api/v1/products/:id/stock below.
  fastify.put<{ Params: { id: string } }>('/api/v1/products/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) return reply.status(400).send({ error: 'Invalid id', code: 'VALIDATION_ERROR' })

    const body = updateProductSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: body.error.flatten() })
    const d = body.data

    const [current] = await db.select().from(products).where(eq(products.id, request.params.id))
    if (!current) return reply.status(404).send({ error: 'Product not found', code: 'NOT_FOUND' })

    if (d.sku !== undefined && d.sku !== current.sku) {
      const [conflict] = await db.select({ id: products.id }).from(products).where(eq(products.sku, d.sku))
      if (conflict && conflict.id !== current.id) {
        return reply.status(409).send({ error: `SKU "${d.sku}" is already used by another product`, code: 'DUPLICATE_SKU' })
      }
    }

    const updateSet: Partial<typeof products.$inferInsert> = {}
    if (d.sku         !== undefined) updateSet.sku       = d.sku
    if (d.name        !== undefined) updateSet.name      = d.name
    if (d.wooTitle     !== undefined) updateSet.wooTitle  = d.wooTitle
    if (d.notes        !== undefined) updateSet.notes     = d.notes
    if (d.costPrice    !== undefined) updateSet.costPrice   = d.costPrice   != null ? String(d.costPrice)   : null
    if (d.retailPrice  !== undefined) updateSet.retailPrice = d.retailPrice != null ? String(d.retailPrice) : null
    if (d.brand        !== undefined) updateSet.brandId    = await resolveBrandId(d.brand)
    if (d.category     !== undefined) updateSet.categoryId = await resolveCategoryId(d.category)

    if (d.imageUrl !== undefined) {
      if (d.imageUrl === null) {
        updateSet.picture = null
      } else {
        const img = await downloadAndStoreProductImage(d.imageUrl, d.sku ?? current.sku)
        if (!img.ok) return reply.status(400).send({ error: img.error, code: 'IMAGE_FETCH_FAILED' })
        updateSet.picture = img.path
      }
    }

    if (Object.keys(updateSet).length > 0) {
      await db.update(products).set(updateSet).where(eq(products.id, current.id))
    }

    const attrInput: { model?: string | null; sizeOptionId?: string | null; colorOptionId?: string | null; unitOptionId?: string | null } = {}
    if (d.model !== undefined) attrInput.model         = d.model
    if (d.size  !== undefined) attrInput.sizeOptionId  = await resolveAttributeOptionId('size',  d.size)
    if (d.color !== undefined) attrInput.colorOptionId = await resolveAttributeOptionId('color', d.color)
    if (d.unit  !== undefined) attrInput.unitOptionId  = await resolveAttributeOptionId('unit',  d.unit)
    if (Object.keys(attrInput).length > 0) await upsertAttributes(current.id, attrInput)

    const detail = await fetchProductDetail(current.id)
    return { data: detail }
  })

  // ── Set stock for one warehouse ─────────────────────────────────────────────
  // Sets the *absolute* on-hand quantity for a product in one warehouse (not a
  // delta) — idempotent, so retries/re-sends are safe. Creates the stock row if
  // the product isn't in that warehouse yet, otherwise adjusts it, recording a
  // ledger entry either way so the change is auditable. If the warehouse is the
  // Main warehouse, a WooCommerce stock sync is enqueued automatically.
  fastify.put<{ Params: { id: string } }>('/api/v1/products/:id/stock', async (request, reply) => {
    if (!isValidUuid(request.params.id)) return reply.status(400).send({ error: 'Invalid id', code: 'VALIDATION_ERROR' })

    const body = setStockSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: body.error.flatten() })
    const d = body.data

    const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, request.params.id))
    if (!product) return reply.status(404).send({ error: 'Product not found', code: 'NOT_FOUND' })

    const [warehouse] = await db.select({ id: warehouses.id, type: warehouses.type }).from(warehouses)
      .where(eq(warehouses.id, d.warehouseId))
    if (!warehouse) return reply.status(404).send({ error: 'warehouseId not found', code: 'NOT_FOUND' })

    const [existingStock] = await db.select().from(inventoryStock)
      .where(and(eq(inventoryStock.productId, product.id), eq(inventoryStock.warehouseId, warehouse.id)))

    if (!existingStock) {
      await db.insert(inventoryStock).values({
        productId:  product.id,
        warehouseId: warehouse.id,
        boxNumber:  d.boxNumber ?? null,
        quantity:   d.quantity,
        dateAdded:  sql`CURRENT_DATE`,
      })
      if (d.quantity > 0) {
        await db.insert(inventoryLedger).values({
          productId:     product.id,
          warehouseId:   warehouse.id,
          actionType:    'receive',
          quantityDelta: d.quantity,
          notes:         `Stock set via API token "${request.apiToken?.name ?? 'unknown'}"`,
        })
      }
    } else {
      const delta = d.quantity - existingStock.quantity
      await db.update(inventoryStock)
        .set({ quantity: d.quantity, ...(d.boxNumber !== undefined ? { boxNumber: d.boxNumber } : {}) })
        .where(and(eq(inventoryStock.productId, product.id), eq(inventoryStock.warehouseId, warehouse.id)))
      if (delta !== 0) {
        await db.insert(inventoryLedger).values({
          productId:     product.id,
          warehouseId:   warehouse.id,
          actionType:    'adjustment',
          quantityDelta: delta,
          notes:         `Stock set via API token "${request.apiToken?.name ?? 'unknown'}" (${delta > 0 ? '+' : ''}${delta})`,
        })
      }
    }

    if (warehouse.type === 'main') {
      try {
        await enqueueSyncWooStock(product.id)
      } catch (err) {
        request.log.warn({ err, productId: product.id }, '[api/v1] Failed to enqueue Woo sync after stock update')
      }
    }

    const detail = await fetchProductDetail(product.id)
    return { data: detail }
  })

  // ── Reference data — brands, categories, attribute definitions ─────────────
  fastify.get('/api/v1/brands', async () => ({
    data: await db.select().from(brands).orderBy(brands.name),
  }))

  fastify.get('/api/v1/categories', async () => ({
    data: await db.select().from(categories).orderBy(categories.name),
  }))

  fastify.get('/api/v1/attributes', async () => {
    const defs = await db.select().from(attributeDefinitions).orderBy(attributeDefinitions.sortOrder)
    const opts = await db.select().from(attributeOptions).orderBy(attributeOptions.sortOrder)
    return {
      data: defs.map(d => ({ ...d, options: opts.filter(o => o.definitionId === d.id) })),
    }
  })
}
