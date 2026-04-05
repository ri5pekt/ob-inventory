import type { FastifyPluginAsync } from 'fastify'
import { eq, count, desc, and, or, ilike } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { warehouses, inventoryStock, inventoryLedger, products } from '@ob-inventory/db'

// Stock and product CRUD live in warehouse-stock.ts and warehouse-products.ts

const createWarehouseSchema = z.object({
  name:  z.string().min(1),
  type:  z.enum(['main', 'partner', 'other']),
  notes: z.string().optional(),
})

const updateWarehouseSchema = z.object({
  name:  z.string().min(1).optional(),
  type:  z.enum(['main', 'partner', 'other']).optional(),
  notes: z.string().nullable().optional(),
  color: z.string().min(1).optional(),
  icon:  z.string().min(1).optional(),
  logo:  z.string().nullable().optional(),
})

export const warehouseRoutes: FastifyPluginAsync = async (fastify) => {
  // ── List warehouses with stock count ───────────────────────────────────────
  fastify.get('/api/warehouses', { onRequest: [fastify.authenticate] }, async () => {
    const rows = await db
      .select({
        id: warehouses.id,
        name: warehouses.name,
        type: warehouses.type,
        isActive: warehouses.isActive,
        notes: warehouses.notes,
        color: warehouses.color,
        icon: warehouses.icon,
        logo: warehouses.logo,
        createdAt: warehouses.createdAt,
        stockCount: count(inventoryStock.productId),
      })
      .from(warehouses)
      .leftJoin(inventoryStock, eq(warehouses.id, inventoryStock.warehouseId))
      .groupBy(warehouses.id)
      .orderBy(warehouses.type, warehouses.name)

    return rows
  })

  // ── Update warehouse (name / type / notes / color / icon) ──────────────────
  fastify.put<{ Params: { id: string } }>(
    '/api/warehouses/:id',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const body = updateWarehouseSchema.safeParse(request.body)
      if (!body.success) return reply.status(400).send({ error: 'Invalid input', details: body.error.flatten() })

      const [existing] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, request.params.id))
      if (!existing) return reply.status(404).send({ error: 'Warehouse not found' })

      const updates: Partial<typeof warehouses.$inferInsert> = {}
      if (body.data.name  !== undefined) updates.name  = body.data.name
      if (body.data.type  !== undefined) updates.type  = body.data.type
      if (body.data.notes !== undefined) updates.notes = body.data.notes ?? undefined
      if (body.data.color !== undefined) updates.color = body.data.color
      if (body.data.icon  !== undefined) updates.icon  = body.data.icon
      if (body.data.logo  !== undefined) updates.logo  = body.data.logo ?? null

      const [updated] = await db.update(warehouses)
        .set(updates)
        .where(eq(warehouses.id, request.params.id))
        .returning()

      return updated
    }
  )

  // ── Warehouse stock movements (ledger entries for one warehouse) ──────────────
  fastify.get<{ Params: { id: string } }>(
    '/api/warehouses/:id/ledger',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const qSchema = z.object({
        actionType: z.enum(['receive', 'transfer_in', 'transfer_out', 'sale', 'return', 'adjustment']).optional(),
        q:          z.string().optional(),
        limit:      z.coerce.number().int().min(1).max(1000).default(500),
        offset:     z.coerce.number().int().min(0).default(0),
      })
      const params = qSchema.safeParse((request as { query: unknown }).query)
      if (!params.success) return reply.status(400).send({ error: 'Invalid query params' })

      const { actionType, q, limit, offset } = params.data
      const warehouseId = request.params.id

      const [wh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, warehouseId))
      if (!wh) return reply.status(404).send({ error: 'Warehouse not found' })

      const filters: ReturnType<typeof and>[] = [eq(inventoryLedger.warehouseId, warehouseId)]
      if (actionType) filters.push(eq(inventoryLedger.actionType, actionType))
      if (q?.trim()) {
        const term = `%${q.trim()}%`
        filters.push(or(ilike(products.sku, term), ilike(products.name, term)) as ReturnType<typeof and>)
      }

      const rows = await db
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
        })
        .from(inventoryLedger)
        .leftJoin(products, eq(inventoryLedger.productId, products.id))
        .where(and(...filters))
        .orderBy(desc(inventoryLedger.createdAt))
        .limit(limit)
        .offset(offset)

      return rows
    },
  )

  // ── Create warehouse ────────────────────────────────────────────────────────
  fastify.post('/api/warehouses', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const body = createWarehouseSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: body.error.flatten() })
    }

    const [warehouse] = await db
      .insert(warehouses)
      .values({ name: body.data.name, type: body.data.type, notes: body.data.notes })
      .returning()

    return reply.status(201).send(warehouse)
  })

}
