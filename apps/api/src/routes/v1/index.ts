import type { FastifyPluginAsync } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { eq } from 'drizzle-orm'
import crypto from 'node:crypto'
import { db } from '../../db.js'
import { env } from '../../env.js'
import { apiTokens, apiTokenRequests } from '@ob-inventory/db'
import { productsV1Routes } from './products.js'
import { warehousesV1Routes } from './warehouses.js'
import { inventoryV1Routes } from './inventory.js'
import { transfersV1Routes } from './transfers.js'
import { salesV1Routes } from './sales.js'
import { quotesV1Routes } from './quotes.js'
import { customersV1Routes } from './customers.js'
import { usersV1Routes } from './users.js'
import { storesV1Routes } from './stores.js'
import { statsV1Routes } from './stats.js'

/**
 * External, read-only API for agents/scripts — token-based auth, separate
 * from the JWT session used by the SPA. See docs/EXTERNAL_API_REFERENCE.md.
 */
export const apiV1Routes: FastifyPluginAsync = async (fastify) => {
  // ── Token auth — runs first so rate limiting can be keyed per token ─────────
  fastify.addHook('onRequest', async (request, reply) => {
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing Authorization header', code: 'UNAUTHORIZED' })
    }
    const raw       = authHeader.slice(7)
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex')

    const [token] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash))
    if (!token || !token.isActive || token.revokedAt) {
      return reply.status(401).send({ error: 'Invalid or revoked token', code: 'INVALID_TOKEN' })
    }
    if (token.expiresAt && token.expiresAt < new Date()) {
      return reply.status(401).send({ error: 'Token expired', code: 'TOKEN_EXPIRED' })
    }

    request.apiToken = { id: token.id, name: token.name }
    // Fire-and-forget — never block the response on this.
    void db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, token.id))
  })

  // ── Rate limiting — per token (falls back to IP if somehow unauthenticated) ─
  await fastify.register(rateLimit, {
    max: env.API_V1_RATE_LIMIT,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.apiToken?.id ?? request.ip,
    errorResponseBuilder: (_request, context) => ({
      error: `Rate limit exceeded — try again in ${context.after}`,
      code: 'RATE_LIMITED',
    }),
  })

  // ── Usage log — best-effort, never blocks or fails the response ─────────────
  fastify.addHook('onResponse', async (request, reply) => {
    if (!request.apiToken) return
    try {
      await db.insert(apiTokenRequests).values({
        tokenId:    request.apiToken.id,
        method:     request.method,
        path:       request.url,
        statusCode: reply.statusCode,
        ip:         request.ip,
      })
    } catch {
      // Never fail the request over logging.
    }
  })

  // ── Resource routes ──────────────────────────────────────────────────────────
  await fastify.register(productsV1Routes)
  await fastify.register(warehousesV1Routes)
  await fastify.register(inventoryV1Routes)
  await fastify.register(transfersV1Routes)
  await fastify.register(salesV1Routes)
  await fastify.register(quotesV1Routes)
  await fastify.register(customersV1Routes)
  await fastify.register(usersV1Routes)
  await fastify.register(storesV1Routes)
  await fastify.register(statsV1Routes)
}
