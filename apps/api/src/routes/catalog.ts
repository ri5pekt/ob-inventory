import type { FastifyPluginAsync } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import {
  categories,
  brands,
  attributeDefinitions,
  attributeOptions,
} from '@ob-inventory/db'

export const catalogRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── Categories ────────────────────────────────────────────────────────────
  fastify.get('/api/categories', auth, async () =>
    db.select().from(categories).orderBy(categories.name),
  )

  fastify.post('/api/categories', auth, async (request, reply) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(request.body)
    const [row] = await db.insert(categories).values({ name }).returning()
    return reply.status(201).send(row)
  })

  fastify.put<{ Params: { id: string } }>('/api/categories/:id', auth, async (request, reply) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(request.body)
    const [row] = await db.update(categories).set({ name }).where(eq(categories.id, request.params.id)).returning()
    if (!row) return reply.status(404).send({ error: 'Not found' })
    return row
  })

  fastify.delete<{ Params: { id: string } }>('/api/categories/:id', auth, async (request, reply) => {
    await db.delete(categories).where(eq(categories.id, request.params.id))
    return reply.status(204).send()
  })

  // ── Brands ────────────────────────────────────────────────────────────────
  fastify.get('/api/brands', auth, async () =>
    db.select().from(brands).orderBy(brands.name),
  )

  fastify.post('/api/brands', auth, async (request, reply) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(request.body)
    const [row] = await db.insert(brands).values({ name }).returning()
    return reply.status(201).send(row)
  })

  fastify.put<{ Params: { id: string } }>('/api/brands/:id', auth, async (request, reply) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(request.body)
    const [row] = await db.update(brands).set({ name }).where(eq(brands.id, request.params.id)).returning()
    if (!row) return reply.status(404).send({ error: 'Not found' })
    return row
  })

  fastify.delete<{ Params: { id: string } }>('/api/brands/:id', auth, async (request, reply) => {
    await db.delete(brands).where(eq(brands.id, request.params.id))
    return reply.status(204).send()
  })

  // ── Attribute definitions (with options) ─────────────────────────────────
  fastify.get('/api/attributes', auth, async () => {
    const defs = await db.select().from(attributeDefinitions).orderBy(attributeDefinitions.sortOrder)
    const opts = await db.select().from(attributeOptions).orderBy(attributeOptions.sortOrder)
    return defs.map(d => ({
      ...d,
      options: opts.filter(o => o.definitionId === d.id),
    }))
  })

  fastify.post('/api/attributes', auth, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1),
      inputType: z.enum(['select', 'text', 'number']),
      isRequired: z.boolean().default(false),
      sortOrder: z.number().int().default(0),
    }).parse(request.body)
    const [row] = await db.insert(attributeDefinitions).values(body).returning()
    return reply.status(201).send({ ...row, options: [] })
  })

  fastify.put<{ Params: { id: string } }>('/api/attributes/:id', auth, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1).optional(),
      isRequired: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }).parse(request.body)
    const [row] = await db.update(attributeDefinitions).set(body).where(eq(attributeDefinitions.id, request.params.id)).returning()
    if (!row) return reply.status(404).send({ error: 'Not found' })
    return row
  })

  fastify.delete<{ Params: { id: string } }>('/api/attributes/:id', auth, async (request, reply) => {
    await db.delete(attributeDefinitions).where(eq(attributeDefinitions.id, request.params.id))
    return reply.status(204).send()
  })

  // ── Attribute options ─────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/api/attributes/:id/options', auth, async (request, reply) => {
    const body = z.object({
      code: z.string().min(1),
      label: z.string().min(1),
      sortOrder: z.number().int().default(0),
    }).parse(request.body)
    const [row] = await db.insert(attributeOptions)
      .values({ ...body, definitionId: request.params.id })
      .returning()
    return reply.status(201).send(row)
  })

  fastify.put<{ Params: { optionId: string } }>('/api/attributes/options/:optionId', auth, async (request, reply) => {
    const body = z.object({
      code: z.string().min(1).optional(),
      label: z.string().min(1).optional(),
      sortOrder: z.number().int().optional(),
    }).parse(request.body)
    const [row] = await db.update(attributeOptions).set(body).where(eq(attributeOptions.id, request.params.optionId)).returning()
    if (!row) return reply.status(404).send({ error: 'Not found' })
    return row
  })

  fastify.delete<{ Params: { optionId: string } }>('/api/attributes/options/:optionId', auth, async (request, reply) => {
    await db.delete(attributeOptions).where(eq(attributeOptions.id, request.params.optionId))
    return reply.status(204).send()
  })
}
