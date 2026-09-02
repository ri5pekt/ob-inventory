import type { FastifyPluginAsync } from 'fastify'
import { eq, and, gte, lte, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db.js'
import { transfers, transferItems, warehouses } from '@ob-inventory/db'
import { isValidUuid } from './_util.js'

export const transfersV1Routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/transfers', async (request, reply) => {
    const qSchema = z.object({
      fromWarehouseId: z.string().uuid().optional(),
      toWarehouseId:   z.string().uuid().optional(),
      status:          z.enum(['completed', 'cancelled']).optional(),
      dateFrom:        z.string().optional(),
      dateTo:          z.string().optional(),
      limit:           z.coerce.number().int().min(1).max(1000).default(100),
      offset:          z.coerce.number().int().min(0).default(0),
    })
    const q = qSchema.safeParse((request as { query: unknown }).query)
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: q.error.flatten() })
    const f = q.data

    const filters: ReturnType<typeof eq>[] = []
    if (f.fromWarehouseId) filters.push(eq(transfers.fromWarehouseId, f.fromWarehouseId))
    if (f.toWarehouseId)   filters.push(eq(transfers.toWarehouseId, f.toWarehouseId))
    if (f.status)          filters.push(eq(transfers.status, f.status))
    if (f.dateFrom)         filters.push(gte(transfers.transferDate, new Date(f.dateFrom)) as ReturnType<typeof eq>)
    if (f.dateTo)           filters.push(lte(transfers.transferDate, new Date(f.dateTo)) as ReturnType<typeof eq>)
    const where = filters.length > 0 ? and(...filters) : undefined

    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(transfers).where(where)

    const rows = await db
      .select({
        id:              transfers.id,
        status:          transfers.status,
        reference:       transfers.reference,
        notes:           transfers.notes,
        fromWarehouseId: transfers.fromWarehouseId,
        toWarehouseId:   transfers.toWarehouseId,
        transferDate:    transfers.transferDate,
        createdAt:       transfers.createdAt,
        itemCount:       sql<number>`count(${transferItems.id})`,
      })
      .from(transfers)
      .leftJoin(transferItems, eq(transfers.id, transferItems.transferId))
      .where(where)
      .groupBy(transfers.id)
      .orderBy(sql`${transfers.transferDate} desc`)
      .limit(f.limit)
      .offset(f.offset)

    if (rows.length === 0) return { data: [], pagination: { limit: f.limit, offset: f.offset, total: Number(total) } }

    const whIds = [...new Set(rows.flatMap(r => [r.fromWarehouseId, r.toWarehouseId]))]
    const whRows = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(inArray(warehouses.id, whIds))
    const whMap = new Map(whRows.map(w => [w.id, w.name]))

    return {
      data: rows.map(r => ({
        ...r,
        itemCount:         Number(r.itemCount),
        fromWarehouseName: whMap.get(r.fromWarehouseId) ?? null,
        toWarehouseName:   whMap.get(r.toWarehouseId) ?? null,
      })),
      pagination: { limit: f.limit, offset: f.offset, total: Number(total) },
    }
  })

  fastify.get<{ Params: { id: string } }>('/api/v1/transfers/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) return reply.status(400).send({ error: 'Invalid id', code: 'VALIDATION_ERROR' })

    const [transfer] = await db.select().from(transfers).where(eq(transfers.id, request.params.id))
    if (!transfer) return reply.status(404).send({ error: 'Transfer not found', code: 'NOT_FOUND' })

    const items = await db.select().from(transferItems).where(eq(transferItems.transferId, transfer.id)).orderBy(transferItems.sku)
    return { data: { ...transfer, items } }
  })
}
