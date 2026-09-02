import type { FastifyPluginAsync } from 'fastify'
import { eq, desc } from 'drizzle-orm'
import { z } from 'zod'
import crypto from 'node:crypto'
import { db } from '../db.js'
import { apiTokens, apiTokenRequests } from '@ob-inventory/db'

const adminOnly = async (request: Parameters<FastifyPluginAsync>[0] & { user?: { role?: string } }, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) => {
  if ((request.user as { role: string })?.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required', code: 'FORBIDDEN' })
  }
}

function generateToken() {
  const raw    = 'obk_' + crypto.randomBytes(24).toString('hex')
  const hash   = crypto.createHash('sha256').update(raw).digest('hex')
  const prefix = raw.slice(0, 12)
  return { raw, hash, prefix }
}

/**
 * Internal, JWT-protected admin endpoints for issuing/managing the API tokens
 * that external agents/scripts use to call /api/v1/*. Not part of the
 * external API surface itself.
 */
export const apiTokensRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── List tokens (never the hash / raw token) ───────────────────────────────
  fastify.get('/api/tokens', auth, async (request, reply) => {
    await adminOnly(request as never, reply)

    const rows = await db
      .select({
        id:          apiTokens.id,
        name:        apiTokens.name,
        tokenPrefix: apiTokens.tokenPrefix,
        isActive:    apiTokens.isActive,
        expiresAt:   apiTokens.expiresAt,
        lastUsedAt:  apiTokens.lastUsedAt,
        createdAt:   apiTokens.createdAt,
        revokedAt:   apiTokens.revokedAt,
      })
      .from(apiTokens)
      .orderBy(desc(apiTokens.createdAt))

    return rows
  })

  // ── Create token — raw value returned exactly once ─────────────────────────
  fastify.post('/api/tokens', auth, async (request, reply) => {
    await adminOnly(request as never, reply)

    const schema = z.object({
      name:      z.string().min(1),
      expiresAt: z.string().datetime().optional(),
    })
    const body = schema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: body.error.flatten() })

    const { raw, hash, prefix } = generateToken()
    const me = (request.user as { id: string }).id

    const [token] = await db.insert(apiTokens).values({
      name:        body.data.name,
      tokenPrefix: prefix,
      tokenHash:   hash,
      expiresAt:   body.data.expiresAt ? new Date(body.data.expiresAt) : null,
      createdBy:   me,
    }).returning({
      id:          apiTokens.id,
      name:        apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      expiresAt:   apiTokens.expiresAt,
      createdAt:   apiTokens.createdAt,
    })

    // `token` is shown once — the caller must copy it now, it is never retrievable again.
    return reply.status(201).send({ ...token, token: raw })
  })

  // ── Revoke (soft) ────────────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/api/tokens/:id/revoke', auth, async (request, reply) => {
    await adminOnly(request as never, reply)

    const [token] = await db.select({ id: apiTokens.id }).from(apiTokens).where(eq(apiTokens.id, request.params.id))
    if (!token) return reply.status(404).send({ error: 'Token not found' })

    await db.update(apiTokens)
      .set({ isActive: false, revokedAt: new Date() })
      .where(eq(apiTokens.id, request.params.id))

    return { ok: true }
  })

  // ── Delete (hard) ────────────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/tokens/:id', auth, async (request, reply) => {
    await adminOnly(request as never, reply)

    const [token] = await db.select({ id: apiTokens.id }).from(apiTokens).where(eq(apiTokens.id, request.params.id))
    if (!token) return reply.status(404).send({ error: 'Token not found' })

    await db.delete(apiTokens).where(eq(apiTokens.id, request.params.id))
    return { ok: true }
  })

  // ── Recent usage for one token (debugging / visibility) ────────────────────
  fastify.get<{ Params: { id: string } }>('/api/tokens/:id/usage', auth, async (request, reply) => {
    await adminOnly(request as never, reply)

    const rows = await db
      .select({
        id:         apiTokenRequests.id,
        method:     apiTokenRequests.method,
        path:       apiTokenRequests.path,
        statusCode: apiTokenRequests.statusCode,
        ip:         apiTokenRequests.ip,
        createdAt:  apiTokenRequests.createdAt,
      })
      .from(apiTokenRequests)
      .where(eq(apiTokenRequests.tokenId, request.params.id))
      .orderBy(desc(apiTokenRequests.createdAt))
      .limit(100)

    return rows
  })
}
