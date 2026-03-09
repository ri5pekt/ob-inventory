import type { FastifyPluginAsync } from 'fastify'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { enqueueSyncWooStock } from '../queue.js'
import {
  warehouses,
  inventoryStock,
  inventoryLedger,
  products,
  productAttributes,
  attributeDefinitions,
} from '@ob-inventory/db'

const addProductSchema = z.object({
  sku:           z.string().min(1),
  name:          z.string().min(1),
  wooTitle:      z.string().nullable().optional(),
  brandId:       z.string().uuid().nullable().optional(),
  categoryId:    z.string().uuid().nullable().optional(),
  boxNumber:     z.string().nullable().optional(),
  dateAdded:     z.string().nullable().optional(),
  quantity:      z.number().int().min(0).default(0),
  model:         z.string().nullable().optional(),
  sizeOptionId:  z.string().uuid().nullable().optional(),
  colorOptionId: z.string().uuid().nullable().optional(),
  unitOptionId:  z.string().uuid().nullable().optional(),
})

const updateProductSchema = z.object({
  sku:           z.string().min(1),
  name:          z.string().min(1),
  wooTitle:      z.string().nullable().optional(),
  brandId:       z.string().uuid().nullable().optional(),
  categoryId:    z.string().uuid().nullable().optional(),
  boxNumber:     z.string().nullable().optional(),
  dateAdded:     z.string().nullable().optional(),
  quantity:      z.number().int().min(0),
  model:         z.string().nullable().optional(),
  sizeOptionId:  z.string().uuid().nullable().optional(),
  colorOptionId: z.string().uuid().nullable().optional(),
  unitOptionId:  z.string().uuid().nullable().optional(),
  image:         z.string().nullable().optional(),
})

async function upsertAttributes(
  productId: string,
  d: { model?: string | null; sizeOptionId?: string | null; colorOptionId?: string | null; unitOptionId?: string | null },
) {
  const defs   = await db.select().from(attributeDefinitions)
  const defMap = new Map(defs.map(df => [df.name.toLowerCase(), df.id]))

  const attrRows: typeof productAttributes.$inferInsert[] = []
  if (d.model !== undefined)
    attrRows.push({ productId, definitionId: defMap.get('model')!,  valueText: d.model || null, optionId: null })
  if (d.sizeOptionId !== undefined)
    attrRows.push({ productId, definitionId: defMap.get('size')!,   optionId: d.sizeOptionId  || null, valueText: null })
  if (d.colorOptionId !== undefined)
    attrRows.push({ productId, definitionId: defMap.get('color')!,  optionId: d.colorOptionId || null, valueText: null })
  if (d.unitOptionId !== undefined)
    attrRows.push({ productId, definitionId: defMap.get('unit')!,   optionId: d.unitOptionId  || null, valueText: null })

  if (attrRows.length > 0) {
    await db.insert(productAttributes).values(attrRows)
      .onConflictDoUpdate({
        target: [productAttributes.productId, productAttributes.definitionId],
        set: { optionId: sql`excluded.option_id`, valueText: sql`excluded.value_text` },
      })
  }
}

export const warehouseProductRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── Add product to warehouse stock ─────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/api/warehouses/:id/stock', auth, async (request, reply) => {
    const { id: warehouseId } = request.params

    const body = addProductSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: body.error.flatten() })
    const d = body.data

    const [warehouse] = await db.select().from(warehouses).where(eq(warehouses.id, warehouseId))
    if (!warehouse) return reply.status(404).send({ error: 'Warehouse not found', code: 'NOT_FOUND' })

    const [existing] = await db.select().from(products).where(eq(products.sku, d.sku))

    if (existing) {
      const [alreadyInStock] = await db.select()
        .from(inventoryStock)
        .where(and(eq(inventoryStock.productId, existing.id), eq(inventoryStock.warehouseId, warehouseId)))

      if (alreadyInStock) {
        return reply.status(409).send({ error: `SKU "${d.sku}" is already in this warehouse`, code: 'DUPLICATE_SKU' })
      }
    }

    const [product] = existing
      ? [existing]
      : await db.insert(products)
          .values({ sku: d.sku, name: d.name, wooTitle: d.wooTitle ?? null, brandId: d.brandId ?? null, categoryId: d.categoryId ?? null, dateAdded: d.dateAdded ?? null })
          .returning()

    await upsertAttributes(product.id, d)

    await db.insert(inventoryStock).values({ productId: product.id, warehouseId, boxNumber: d.boxNumber ?? null, quantity: d.quantity })

    if (d.quantity > 0) {
      await db.insert(inventoryLedger).values({ productId: product.id, warehouseId, actionType: 'receive', quantityDelta: d.quantity, notes: 'Manual entry via UI' })
    }

    const [wh] = await db.select({ type: warehouses.type }).from(warehouses).where(eq(warehouses.id, warehouseId))
    if (wh?.type === 'main') {
      request.log.info({ productId: product.id, sku: d.sku, quantity: d.quantity }, '[sync-woo-stock] Quantity update request received')
      try {
        const jobId = await enqueueSyncWooStock(product.id)
        request.log.info({ productId: product.id, jobId }, '[sync-woo-stock] Job enqueued')
      } catch (err) {
        request.log.warn({ err, productId: product.id }, '[sync-woo-stock] Failed to enqueue')
      }
    }

    return reply.status(201).send({ productId: product.id })
  })

  // ── Update product stock ────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string; productId: string } }>('/api/warehouses/:id/stock/:productId', auth, async (request, reply) => {
    const { id: warehouseId, productId } = request.params

    const body = updateProductSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: body.error.flatten() })
    const d = body.data

    const [stockRow] = await db.select().from(inventoryStock)
      .where(and(eq(inventoryStock.productId, productId), eq(inventoryStock.warehouseId, warehouseId)))
    if (!stockRow) return reply.status(404).send({ error: 'Stock record not found', code: 'NOT_FOUND' })

    const [currentProduct] = await db.select().from(products).where(eq(products.id, productId))
    if (!currentProduct) return reply.status(404).send({ error: 'Product not found', code: 'NOT_FOUND' })

    if (d.sku !== currentProduct.sku) {
      const [skuConflict] = await db.select().from(products).where(eq(products.sku, d.sku))
      if (skuConflict && skuConflict.id !== productId) {
        return reply.status(409).send({ error: `SKU "${d.sku}" is already used by another product`, code: 'DUPLICATE_SKU' })
      }
    }

    await db.update(products)
      .set({
        sku:        d.sku,
        name:       d.name,
        wooTitle:   d.wooTitle   ?? null,
        brandId:    d.brandId    ?? null,
        categoryId: d.categoryId ?? null,
        dateAdded:  d.dateAdded  ?? null,
        ...(d.image !== undefined ? { picture: d.image ?? null } : {}),
      })
      .where(eq(products.id, productId))

    await upsertAttributes(productId, d)

    const quantityDelta = d.quantity - stockRow.quantity
    await db.update(inventoryStock)
      .set({ boxNumber: d.boxNumber ?? null, quantity: d.quantity })
      .where(and(eq(inventoryStock.productId, productId), eq(inventoryStock.warehouseId, warehouseId)))

    if (quantityDelta !== 0) {
      await db.insert(inventoryLedger).values({
        productId,
        warehouseId,
        actionType:    'adjustment',
        quantityDelta,
        notes:         `Manual edit via UI (${quantityDelta > 0 ? '+' : ''}${quantityDelta})`,
      })
    }

    const [wh] = await db.select({ type: warehouses.type }).from(warehouses).where(eq(warehouses.id, warehouseId))
    if (wh?.type === 'main') {
      request.log.info({ productId, sku: d.sku, quantity: d.quantity }, '[sync-woo-stock] Quantity update request received')
      try {
        const jobId = await enqueueSyncWooStock(productId)
        request.log.info({ productId, jobId }, '[sync-woo-stock] Job enqueued')
      } catch (err) {
        request.log.warn({ err, productId }, '[sync-woo-stock] Failed to enqueue')
      }
    }

    return { ok: true }
  })
}
