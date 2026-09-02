import type { FastifyPluginAsync } from 'fastify'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../db.js'
import { warehouses, inventoryStock } from '@ob-inventory/db'

export const warehousesV1Routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/warehouses', async () => {
    const rows = await db
      .select({
        id:            warehouses.id,
        name:          warehouses.name,
        type:          warehouses.type,
        isActive:      warehouses.isActive,
        notes:         warehouses.notes,
        createdAt:     warehouses.createdAt,
        skuCount:      sql<number>`count(${inventoryStock.productId})`,
        totalQuantity: sql<number>`coalesce(sum(${inventoryStock.quantity}), 0)`,
      })
      .from(warehouses)
      .leftJoin(inventoryStock, eq(warehouses.id, inventoryStock.warehouseId))
      .groupBy(warehouses.id)
      .orderBy(warehouses.name)

    return { data: rows.map(r => ({ ...r, skuCount: Number(r.skuCount), totalQuantity: Number(r.totalQuantity) })) }
  })

  fastify.get<{ Params: { id: string } }>('/api/v1/warehouses/:id', async (request, reply) => {
    const [warehouse] = await db.select().from(warehouses).where(eq(warehouses.id, request.params.id))
    if (!warehouse) return reply.status(404).send({ error: 'Warehouse not found', code: 'NOT_FOUND' })
    return { data: warehouse }
  })
}
