import type { FastifyPluginAsync } from 'fastify'
import { eq, count } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { warehouses, inventoryStock } from '@ob-inventory/db'

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
