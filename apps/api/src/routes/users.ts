import type { FastifyPluginAsync } from 'fastify'
import { eq, ne, asc, inArray } from 'drizzle-orm'
import { z } from 'zod'
import argon2 from 'argon2'
import { db } from '../db.js'
import { users, refreshTokens, userWarehouses } from '@ob-inventory/db'

const adminOnly = async (request: Parameters<FastifyPluginAsync>[0] & { user?: { role?: string } }, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) => {
  if ((request.user as { role: string })?.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required', code: 'FORBIDDEN' })
  }
}

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── List all active users with their warehouse assignments ────────────────
  fastify.get('/api/users', auth, async (request, reply) => {
    await adminOnly(request as never, reply)
    const rows = await db
      .select({
        id:        users.id,
        name:      users.name,
        email:     users.email,
        role:      users.role,
        isActive:  users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.createdAt))

    // Attach warehouse IDs for each user
    const userIds = rows.map(r => r.id)
    const assignments = userIds.length > 0
      ? await db
          .select({ userId: userWarehouses.userId, warehouseId: userWarehouses.warehouseId })
          .from(userWarehouses)
          .where(inArray(userWarehouses.userId, userIds))
      : []

    const warehousesByUser = assignments.reduce<Record<string, string[]>>((acc, row) => {
      if (!acc[row.userId]) acc[row.userId] = []
      acc[row.userId].push(row.warehouseId)
      return acc
    }, {})

    return rows.map(r => ({ ...r, warehouseIds: warehousesByUser[r.id] ?? [] }))
  })

  // ── Create user ───────────────────────────────────────────────────────────
  fastify.post('/api/users', auth, async (request, reply) => {
    await adminOnly(request as never, reply)

    const schema = z.object({
      name:         z.string().min(1),
      email:        z.string().email(),
      password:     z.string().min(6),
      role:         z.enum(['admin', 'warehouse_admin']).default('warehouse_admin'),
      warehouseIds: z.array(z.string().uuid()).default([]),
    })
    const body = schema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid input', details: body.error.flatten() })
    const d = body.data

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email))
    if (existing) return reply.status(409).send({ error: 'Email already in use', code: 'DUPLICATE_EMAIL' })

    const passwordHash = await argon2.hash(d.password)
    const [user] = await db.insert(users)
      .values({ name: d.name, email: d.email, passwordHash, role: d.role })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })

    // Insert warehouse assignments
    if (d.role === 'warehouse_admin' && d.warehouseIds.length > 0) {
      await db.insert(userWarehouses)
        .values(d.warehouseIds.map(wid => ({ userId: user.id, warehouseId: wid })))
        .onConflictDoNothing()
    }

    return reply.status(201).send({ ...user, warehouseIds: d.role === 'warehouse_admin' ? d.warehouseIds : [] })
  })

  // ── Update user (name / email / role / password / warehouseIds) ───────────
  fastify.put<{ Params: { id: string } }>('/api/users/:id', auth, async (request, reply) => {
    await adminOnly(request as never, reply)

    const schema = z.object({
      name:         z.string().min(1).optional(),
      email:        z.string().email().optional(),
      role:         z.enum(['admin', 'warehouse_admin']).optional(),
      password:     z.string().min(6).optional(),
      warehouseIds: z.array(z.string().uuid()).optional(),
    })
    const body = schema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid input', details: body.error.flatten() })
    const d = body.data

    const updates: Partial<typeof users.$inferInsert> = {}
    if (d.name)  updates.name  = d.name
    if (d.email) {
      const [dup] = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, d.email))
      if (dup && dup.id !== request.params.id)
        return reply.status(409).send({ error: 'Email already in use', code: 'DUPLICATE_EMAIL' })
      updates.email = d.email
    }
    if (d.role)     updates.role         = d.role
    if (d.password) updates.passwordHash = await argon2.hash(d.password)

    const [updated] = await db.update(users)
      .set(updates)
      .where(eq(users.id, request.params.id))
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role, createdAt: users.createdAt })

    if (!updated) return reply.status(404).send({ error: 'User not found' })

    // Sync warehouse assignments when provided
    if (d.warehouseIds !== undefined) {
      await db.delete(userWarehouses).where(eq(userWarehouses.userId, request.params.id))
      const effectiveRole = d.role ?? updated.role
      if (effectiveRole === 'warehouse_admin' && d.warehouseIds.length > 0) {
        await db.insert(userWarehouses)
          .values(d.warehouseIds.map(wid => ({ userId: request.params.id, warehouseId: wid })))
          .onConflictDoNothing()
      }
    }

    // Return updated warehouse assignments
    const assignments = await db
      .select({ warehouseId: userWarehouses.warehouseId })
      .from(userWarehouses)
      .where(eq(userWarehouses.userId, updated.id))
    return { ...updated, warehouseIds: assignments.map(r => r.warehouseId) }
  })

  // ── Delete (deactivate) user ──────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/users/:id', auth, async (request, reply) => {
    await adminOnly(request as never, reply)

    const me = (request.user as { id: string }).id
    if (request.params.id === me)
      return reply.status(400).send({ error: 'You cannot delete your own account', code: 'SELF_DELETE' })

    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, request.params.id))
    if (!user) return reply.status(404).send({ error: 'User not found' })

    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, request.params.id))

    await db.update(users)
      .set({ isActive: false })
      .where(eq(users.id, request.params.id))

    return { ok: true }
  })
}
