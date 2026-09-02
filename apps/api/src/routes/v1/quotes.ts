import type { FastifyPluginAsync } from 'fastify'
import { eq, and, gte, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db.js'
import { quotes, quoteItems, warehouses } from '@ob-inventory/db'

export const quotesV1Routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/quotes', async (request, reply) => {
    const qSchema = z.object({
      status:      z.enum(['open', 'converted', 'cancelled']).optional(),
      warehouseId: z.string().uuid().optional(),
      dateFrom:    z.string().optional(),
      dateTo:      z.string().optional(),
      limit:       z.coerce.number().int().min(1).max(1000).default(100),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const q = qSchema.safeParse((request as { query: unknown }).query)
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: q.error.flatten() })
    const f = q.data

    const filters: ReturnType<typeof eq>[] = []
    if (f.status)      filters.push(eq(quotes.status, f.status))
    if (f.warehouseId) filters.push(eq(quotes.warehouseId, f.warehouseId))
    if (f.dateFrom)     filters.push(gte(quotes.quoteDate, new Date(f.dateFrom)) as ReturnType<typeof eq>)
    if (f.dateTo)       filters.push(lte(quotes.quoteDate, new Date(f.dateTo)) as ReturnType<typeof eq>)
    const where = filters.length > 0 ? and(...filters) : undefined

    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(quotes).where(where)

    const rows = await db
      .select({
        id:               quotes.id,
        quoteNumber:      quotes.quoteNumber,
        status:           quotes.status,
        warehouseId:      quotes.warehouseId,
        warehouseName:    warehouses.name,
        customerName:     quotes.customerName,
        customerEmail:    quotes.customerEmail,
        customerPhone:    quotes.customerPhone,
        customerAddress:  quotes.customerAddress,
        customerIdNumber: quotes.customerIdNumber,
        totalPrice:       quotes.totalPrice,
        currency:         quotes.currency,
        notes:            quotes.notes,
        quoteDate:        quotes.quoteDate,
        convertedSaleId:  quotes.convertedSaleId,
        createdAt:        quotes.createdAt,
        updatedAt:        quotes.updatedAt,
      })
      .from(quotes)
      .leftJoin(warehouses, eq(quotes.warehouseId, warehouses.id))
      .where(where)
      .orderBy(sql`${quotes.quoteDate} desc`)
      .limit(f.limit)
      .offset(f.offset)

    return { data: rows, pagination: { limit: f.limit, offset: f.offset, total: Number(total) } }
  })

  fastify.get<{ Params: { id: string } }>('/api/v1/quotes/:id', async (request, reply) => {
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, request.params.id))
    if (!quote) return reply.status(404).send({ error: 'Quote not found', code: 'NOT_FOUND' })

    const items = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, quote.id))
    return { data: { ...quote, items } }
  })
}
