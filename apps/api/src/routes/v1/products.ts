import type { FastifyPluginAsync } from 'fastify'
import { eq, and, ilike, or, inArray, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db.js'
import {
  products, brands, categories,
  productAttributes, attributeDefinitions, attributeOptions,
  inventoryStock,
} from '@ob-inventory/db'

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
      .where(eq(products.id, request.params.id))
    if (!product) return reply.status(404).send({ error: 'Product not found', code: 'NOT_FOUND' })

    const [withAttrs] = await attachAttributes([product])

    const stock = await db
      .select({ warehouseId: inventoryStock.warehouseId, quantity: inventoryStock.quantity, boxNumber: inventoryStock.boxNumber })
      .from(inventoryStock)
      .where(eq(inventoryStock.productId, product.id))

    return { data: { ...withAttrs, stock } }
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
