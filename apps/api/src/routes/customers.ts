import type { FastifyPluginAsync } from 'fastify'
import { eq, desc, ilike, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { customers } from '@ob-inventory/db'

const customerBody = z.object({
  name:     z.string().min(1),
  email:    z.string().email().optional().or(z.literal('')),
  phone:    z.string().optional(),
  address:  z.string().optional(),
  company:  z.string().optional(),
  idNumber: z.string().optional(),
  notes:    z.string().optional(),
})

export const customerRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── List ──────────────────────────────────────────────────────────────────
  fastify.get('/api/customers', auth, async (request) => {
    const qSchema = z.object({
      q:      z.string().optional(),
      limit:  z.coerce.number().int().min(1).max(1000).default(500),
      offset: z.coerce.number().int().min(0).default(0),
    })
    const { q, limit, offset } = qSchema.parse((request as { query: unknown }).query)

    const where = q
      ? or(
          ilike(customers.name,    `%${q}%`),
          ilike(customers.email,   `%${q}%`),
          ilike(customers.phone,   `%${q}%`),
          ilike(customers.company, `%${q}%`),
        )
      : undefined

    return db
      .select()
      .from(customers)
      .where(where)
      .orderBy(desc(customers.createdAt))
      .limit(limit)
      .offset(offset)
  })

  // ── Get one ───────────────────────────────────────────────────────────────
  fastify.get('/api/customers/:id', auth, async (request, reply) => {
    const { id } = (request as { params: { id: string } }).params
    const [row] = await db.select().from(customers).where(eq(customers.id, id))
    if (!row) return reply.status(404).send({ error: 'Customer not found' })
    return row
  })

  // ── Create ────────────────────────────────────────────────────────────────
  fastify.post('/api/customers', auth, async (request, reply) => {
    const body = customerBody.parse((request as { body: unknown }).body)
    const [row] = await db
      .insert(customers)
      .values({
        name:     body.name,
        email:    body.email || null,
        phone:    body.phone || null,
        address:  body.address || null,
        company:  body.company || null,
        idNumber: body.idNumber || null,
        notes:    body.notes || null,
      })
      .returning()
    reply.status(201)
    return row
  })

  // ── Update ────────────────────────────────────────────────────────────────
  fastify.put('/api/customers/:id', auth, async (request, reply) => {
    const { id } = (request as { params: { id: string } }).params
    const body = customerBody.parse((request as { body: unknown }).body)

    const [row] = await db
      .update(customers)
      .set({
        name:     body.name,
        email:    body.email || null,
        phone:    body.phone || null,
        address:  body.address || null,
        company:  body.company || null,
        idNumber: body.idNumber || null,
        notes:    body.notes || null,
      })
      .where(eq(customers.id, id))
      .returning()

    if (!row) return reply.status(404).send({ error: 'Customer not found' })
    return row
  })

  // ── Delete ────────────────────────────────────────────────────────────────
  fastify.delete('/api/customers/:id', auth, async (request, reply) => {
    const { id } = (request as { params: { id: string } }).params
    const [row] = await db.delete(customers).where(eq(customers.id, id)).returning()
    if (!row) return reply.status(404).send({ error: 'Customer not found' })
    reply.status(204).send()
  })
}
