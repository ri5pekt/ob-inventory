import type { FastifyPluginAsync } from 'fastify'
import { eq, desc, and, ilike, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { inventoryLedger, products, warehouses } from '@ob-inventory/db'

export const logsRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── Inventory audit log ────────────────────────────────────────────────────
  //
  // GET /api/inventory/logs?actionType=&warehouseId=&q=&limit=&offset=
  //
  // Returns ledger entries enriched with product SKU/name and warehouse name,
  // ordered by most recent first.
  fastify.get('/api/inventory/logs', auth, async (request) => {
    const qSchema = z.object({
      actionType:  z.enum(['receive', 'transfer_in', 'transfer_out', 'sale', 'return', 'adjustment']).optional(),
      warehouseId: z.string().uuid().optional(),
      q:           z.string().optional(),
      limit:       z.coerce.number().int().min(1).max(500).default(100),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const params = qSchema.parse((request as { query: unknown }).query)

    const filters: ReturnType<typeof and>[] = []
    if (params.actionType)  filters.push(eq(inventoryLedger.actionType,  params.actionType))
    if (params.warehouseId) filters.push(eq(inventoryLedger.warehouseId, params.warehouseId))
    if (params.q) {
      const term = `%${params.q.trim()}%`
      filters.push(or(
        ilike(products.sku,  term),
        ilike(products.name, term),
      ) as ReturnType<typeof and>)
    }

    return db
      .select({
        id:            inventoryLedger.id,
        createdAt:     inventoryLedger.createdAt,
        actionType:    inventoryLedger.actionType,
        quantityDelta: inventoryLedger.quantityDelta,
        referenceType: inventoryLedger.referenceType,
        referenceId:   inventoryLedger.referenceId,
        notes:         inventoryLedger.notes,
        productId:     inventoryLedger.productId,
        productSku:    products.sku,
        productName:   products.name,
        warehouseId:   inventoryLedger.warehouseId,
        warehouseName: warehouses.name,
      })
      .from(inventoryLedger)
      .leftJoin(products,   eq(inventoryLedger.productId,   products.id))
      .leftJoin(warehouses, eq(inventoryLedger.warehouseId, warehouses.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(inventoryLedger.createdAt))
      .limit(params.limit)
      .offset(params.offset)
  })
}
