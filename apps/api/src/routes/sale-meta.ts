import type { FastifyPluginAsync } from 'fastify'
import { eq, asc } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { saleTargets, saleInvoiceStatuses, salePaymentMethods } from '@ob-inventory/db'

export const saleMetaRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── Targets ────────────────────────────────────────────────────────────────

  fastify.get('/api/sale-meta/targets', auth, async () => {
    return db.select().from(saleTargets).orderBy(asc(saleTargets.name))
  })

  fastify.post('/api/sale-meta/targets', auth, async (request, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(request.body)
    const [existing] = await db.select().from(saleTargets).where(eq(saleTargets.name, name))
    if (existing) return existing
    const [created] = await db.insert(saleTargets).values({ name }).returning()
    return reply.status(201).send(created)
  })

  fastify.put<{ Params: { id: string } }>('/api/sale-meta/targets/:id', auth, async (request, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(request.body)
    const [updated] = await db.update(saleTargets).set({ name }).where(eq(saleTargets.id, request.params.id)).returning()
    if (!updated) return reply.status(404).send({ error: 'Not found' })
    return updated
  })

  fastify.delete<{ Params: { id: string } }>('/api/sale-meta/targets/:id', auth, async (request, reply) => {
    await db.delete(saleTargets).where(eq(saleTargets.id, request.params.id))
    return reply.status(200).send({ ok: true })
  })

  // ── Invoice statuses ───────────────────────────────────────────────────────

  fastify.get('/api/sale-meta/invoice-statuses', auth, async () => {
    return db.select().from(saleInvoiceStatuses).orderBy(asc(saleInvoiceStatuses.name))
  })

  fastify.post('/api/sale-meta/invoice-statuses', auth, async (request, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(request.body)
    const [existing] = await db.select().from(saleInvoiceStatuses).where(eq(saleInvoiceStatuses.name, name))
    if (existing) return existing
    const [created] = await db.insert(saleInvoiceStatuses).values({ name }).returning()
    return reply.status(201).send(created)
  })

  fastify.put<{ Params: { id: string } }>('/api/sale-meta/invoice-statuses/:id', auth, async (request, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(request.body)
    const [updated] = await db.update(saleInvoiceStatuses).set({ name }).where(eq(saleInvoiceStatuses.id, request.params.id)).returning()
    if (!updated) return reply.status(404).send({ error: 'Not found' })
    return updated
  })

  fastify.delete<{ Params: { id: string } }>('/api/sale-meta/invoice-statuses/:id', auth, async (request, reply) => {
    await db.delete(saleInvoiceStatuses).where(eq(saleInvoiceStatuses.id, request.params.id))
    return reply.status(200).send({ ok: true })
  })

  // ── Payment methods ────────────────────────────────────────────────────────

  fastify.get('/api/sale-meta/payment-methods', auth, async () => {
    return db.select().from(salePaymentMethods).orderBy(asc(salePaymentMethods.name))
  })

  fastify.post('/api/sale-meta/payment-methods', auth, async (request, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(request.body)
    const [existing] = await db.select().from(salePaymentMethods).where(eq(salePaymentMethods.name, name))
    if (existing) return existing
    const [created] = await db.insert(salePaymentMethods).values({ name }).returning()
    return reply.status(201).send(created)
  })

  fastify.put<{ Params: { id: string } }>('/api/sale-meta/payment-methods/:id', auth, async (request, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(request.body)
    const [updated] = await db.update(salePaymentMethods).set({ name }).where(eq(salePaymentMethods.id, request.params.id)).returning()
    if (!updated) return reply.status(404).send({ error: 'Not found' })
    return updated
  })

  fastify.delete<{ Params: { id: string } }>('/api/sale-meta/payment-methods/:id', auth, async (request, reply) => {
    await db.delete(salePaymentMethods).where(eq(salePaymentMethods.id, request.params.id))
    return reply.status(200).send({ ok: true })
  })
}
