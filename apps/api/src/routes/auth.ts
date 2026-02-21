import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import argon2 from 'argon2'
import { eq, and, isNull, gt } from 'drizzle-orm'
import crypto from 'node:crypto'
import { db } from '../db.js'
import { users, refreshTokens } from '@ob-inventory/db'
import { env } from '../env.js'

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
})

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/)
  if (!match) return 365 * 24 * 60 * 60 * 1000
  const value = parseInt(match[1])
  const unit = match[2] as 's' | 'm' | 'h' | 'd'
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return value * multipliers[unit]
}

const REFRESH_TOKEN_MS = parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN)
const COOKIE_MAX_AGE_S = Math.floor(REFRESH_TOKEN_MS / 1000)

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: body.error.flatten() })
    }

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, body.data.email), eq(users.isActive, true)))

    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }

    const valid = await argon2.verify(user.passwordHash, body.data.password)
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }

    const accessToken = fastify.jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN },
    )

    const rawToken = crypto.randomBytes(48).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_MS),
    })

    reply.setCookie('refreshToken', rawToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: COOKIE_MAX_AGE_S,
    })

    return { accessToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } }
  })

  fastify.post('/api/auth/refresh', async (request, reply) => {
    const rawToken = request.cookies['refreshToken']
    if (!rawToken) {
      return reply.status(401).send({ error: 'No refresh token', code: 'NO_REFRESH_TOKEN' })
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const [token] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )

    if (!token) {
      return reply.status(401).send({ error: 'Invalid or expired refresh token', code: 'INVALID_REFRESH_TOKEN' })
    }

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, token.userId), eq(users.isActive, true)))

    if (!user) {
      return reply.status(401).send({ error: 'User not found', code: 'USER_NOT_FOUND' })
    }

    const accessToken = fastify.jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN },
    )

    return { accessToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } }
  })

  fastify.post('/api/auth/logout', async (request, reply) => {
    const rawToken = request.cookies['refreshToken']
    if (rawToken) {
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, tokenHash))
    }
    reply.clearCookie('refreshToken', { path: '/api/auth' })
    return { ok: true }
  })

  fastify.get('/api/auth/me', { onRequest: [fastify.authenticate] }, async (request) => {
    return request.user
  })

  fastify.put('/api/auth/profile', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const schema = z.object({
      name:        z.string().min(1).optional(),
      password:    z.string().min(6).optional(),
      oldPassword: z.string().optional(),
    })
    const body = schema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input', details: body.error.flatten() })
    }
    const d  = body.data
    const me = (request.user as { id: string })

    const [user] = await db.select().from(users).where(eq(users.id, me.id))
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const updates: Partial<typeof users.$inferInsert> = {}
    if (d.name) updates.name = d.name

    if (d.password) {
      if (!d.oldPassword) {
        return reply.status(400).send({ error: 'Current password is required to set a new one', code: 'OLD_PASSWORD_REQUIRED' })
      }
      const valid = await argon2.verify(user.passwordHash, d.oldPassword)
      if (!valid) {
        return reply.status(400).send({ error: 'Current password is incorrect', code: 'WRONG_PASSWORD' })
      }
      updates.passwordHash = await argon2.hash(d.password)
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: 'Nothing to update' })
    }

    const [updated] = await db.update(users)
      .set(updates)
      .where(eq(users.id, me.id))
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role })

    return updated
  })
}
