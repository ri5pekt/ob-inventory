import type { FastifyPluginAsync } from 'fastify'
import { eq, ne, asc } from 'drizzle-orm'
import { z } from 'zod'
import argon2 from 'argon2'
import { db } from '../db.js'
import { users, refreshTokens } from '@ob-inventory/db'

const adminOnly = async (request: Parameters<FastifyPluginAsync>[0] & { user?: { role?: string } }, reply: Parameters<FastifyPluginAsync>[1]) => {
  if ((request.user as { role: string })?.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required', code: 'FORBIDDEN' })
  }
}

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  const auth      = { onRequest: [fastify.authenticate] }

  // ── List all active users ─────────────────────────────────────────────────
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
    return rows
  })

  // ── Create user ───────────────────────────────────────────────────────────
  fastify.post('/api/users', auth, async (request, reply) => {
    await adminOnly(request as never, reply)

    const schema = z.object({
      name:     z.string().min(1),
      email:    z.string().email(),
      password: z.string().min(6),
      role:     z.enum(['admin', 'staff']).default('staff'),
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

    return reply.status(201).send(user)
  })

  // ── Update user (name / email / role / password) ──────────────────────────
  fastify.put<{ Params: { id: string } }>('/api/users/:id', auth, async (request, reply) => {
    await adminOnly(request as never, reply)

    const schema = z.object({
      name:     z.string().min(1).optional(),
      email:    z.string().email().optional(),
      role:     z.enum(['admin', 'staff']).optional(),
      password: z.string().min(6).optional(),
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
    return updated
  })

  // ── Delete (deactivate) user ──────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/users/:id', auth, async (request, reply) => {
    await adminOnly(request as never, reply)

    const me = (request.user as { id: string }).id
    if (request.params.id === me)
      return reply.status(400).send({ error: 'You cannot delete your own account', code: 'SELF_DELETE' })

    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, request.params.id))
    if (!user) return reply.status(404).send({ error: 'User not found' })

    // Revoke all refresh tokens
    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, request.params.id))

    // Soft-delete
    await db.update(users)
      .set({ isActive: false })
      .where(eq(users.id, request.params.id))

    return { ok: true }
  })
}
