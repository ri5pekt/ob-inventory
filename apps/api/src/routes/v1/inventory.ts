import type { FastifyPluginAsync } from 'fastify'
import { eq, and, gte, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db.js'
import { inventoryStock, inventoryLedger, products, warehouses } from '@ob-inventory/db'

export const inventoryV1Routes: FastifyPluginAsync = async (fastify) => {
  // ── Current stock snapshot ───────────────────────────────────────────────────
  fastify.get('/api/v1/inventory/stock', async (request, reply) => {
    const qSchema = z.object({
      warehouseId: z.string().uuid().optional(),
      productId:   z.string().uuid().optional(),
      sku:         z.string().optional(),
      limit:       z.coerce.number().int().min(1).max(1000).default(200),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const q = qSchema.safeParse((request as { query: unknown }).query)
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: q.error.flatten() })
    const f = q.data

    const filters: ReturnType<typeof eq>[] = []
    if (f.warehouseId) filters.push(eq(inventoryStock.warehouseId, f.warehouseId))
    if (f.productId)   filters.push(eq(inventoryStock.productId, f.productId))
    if (f.sku)         filters.push(eq(products.sku, f.sku))
    const where = filters.length > 0 ? and(...filters) : undefined

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(inventoryStock)
      .innerJoin(products, eq(inventoryStock.productId, products.id))
      .where(where)

    const rows = await db
      .select({
        productId:     inventoryStock.productId,
        sku:           products.sku,
        name:          products.name,
        warehouseId:   inventoryStock.warehouseId,
        warehouseName: warehouses.name,
        quantity:      inventoryStock.quantity,
        boxNumber:     inventoryStock.boxNumber,
        dateAdded:     inventoryStock.dateAdded,
        updatedAt:     inventoryStock.updatedAt,
      })
      .from(inventoryStock)
      .innerJoin(products, eq(inventoryStock.productId, products.id))
      .innerJoin(warehouses, eq(inventoryStock.warehouseId, warehouses.id))
      .where(where)
      .orderBy(products.sku)
      .limit(f.limit)
      .offset(f.offset)

    return { data: rows, pagination: { limit: f.limit, offset: f.offset, total: Number(total) } }
  })

  // ── Movements — the append-only inventory ledger ────────────────────────────
  fastify.get('/api/v1/inventory/movements', async (request, reply) => {
    const qSchema = z.object({
      productId:   z.string().uuid().optional(),
      warehouseId: z.string().uuid().optional(),
      actionType:  z.enum(['receive', 'transfer_in', 'transfer_out', 'sale', 'return', 'adjustment']).optional(),
      dateFrom:    z.string().optional(),
      dateTo:      z.string().optional(),
      limit:       z.coerce.number().int().min(1).max(1000).default(200),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const q = qSchema.safeParse((request as { query: unknown }).query)
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: q.error.flatten() })
    const f = q.data

    const filters: ReturnType<typeof eq>[] = []
    if (f.productId)   filters.push(eq(inventoryLedger.productId, f.productId))
    if (f.warehouseId) filters.push(eq(inventoryLedger.warehouseId, f.warehouseId))
    if (f.actionType)  filters.push(eq(inventoryLedger.actionType, f.actionType))
    if (f.dateFrom)    filters.push(gte(inventoryLedger.createdAt, new Date(f.dateFrom)) as ReturnType<typeof eq>)
    if (f.dateTo)      filters.push(lte(inventoryLedger.createdAt, new Date(f.dateTo)) as ReturnType<typeof eq>)
    const where = filters.length > 0 ? and(...filters) : undefined

    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(inventoryLedger).where(where)

    const rows = await db
      .select({
        id:            inventoryLedger.id,
        productId:     inventoryLedger.productId,
        sku:           products.sku,
        name:          products.name,
        warehouseId:   inventoryLedger.warehouseId,
        warehouseName: warehouses.name,
        actionType:    inventoryLedger.actionType,
        quantityDelta: inventoryLedger.quantityDelta,
        referenceId:   inventoryLedger.referenceId,
        referenceType: inventoryLedger.referenceType,
        supplierRef:   inventoryLedger.supplierRef,
        dateReceived:  inventoryLedger.dateReceived,
        reason:        inventoryLedger.reason,
        notes:         inventoryLedger.notes,
        createdAt:     inventoryLedger.createdAt,
      })
      .from(inventoryLedger)
      .leftJoin(products, eq(inventoryLedger.productId, products.id))
      .leftJoin(warehouses, eq(inventoryLedger.warehouseId, warehouses.id))
      .where(where)
      .orderBy(sql`${inventoryLedger.createdAt} desc`)
      .limit(f.limit)
      .offset(f.offset)

    return { data: rows, pagination: { limit: f.limit, offset: f.offset, total: Number(total) } }
  })
}
