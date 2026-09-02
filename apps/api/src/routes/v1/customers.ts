import type { FastifyPluginAsync } from 'fastify'
import { eq, or, ilike, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db.js'
import { customers } from '@ob-inventory/db'

export const customersV1Routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/customers', async (request, reply) => {
    const qSchema = z.object({
      search: z.string().optional(),
      limit:  z.coerce.number().int().min(1).max(1000).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    })
    const q = qSchema.safeParse((request as { query: unknown }).query)
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: q.error.flatten() })
    const f = q.data

    const term = f.search?.trim()
    const where = term
      ? or(ilike(customers.name, `%${term}%`), ilike(customers.email, `%${term}%`), ilike(customers.phone, `%${term}%`))
      : undefined

    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(customers).where(where)

    const rows = await db.select().from(customers).where(where).orderBy(customers.name).limit(f.limit).offset(f.offset)

    return { data: rows, pagination: { limit: f.limit, offset: f.offset, total: Number(total) } }
  })

  fastify.get<{ Params: { id: string } }>('/api/v1/customers/:id', async (request, reply) => {
    const [customer] = await db.select().from(customers).where(eq(customers.id, request.params.id))
    if (!customer) return reply.status(404).send({ error: 'Customer not found', code: 'NOT_FOUND' })
    return { data: customer }
  })
}
