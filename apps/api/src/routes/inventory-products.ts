import type { FastifyPluginAsync } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db.js'
import { enqueueSyncWooStock } from '../queue.js'
import { products } from '@ob-inventory/db'

export const inventoryProductRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── Enqueue Woo sync for a single product ───────────────────────────────────
  fastify.post<{ Params: { productId: string } }>(
    '/api/inventory/products/:productId/sync-quantity',
    auth,
    async (request, reply) => {
      const { productId } = request.params

      const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId))
      if (!product) {
        return reply.status(404).send({ error: 'Product not found', code: 'NOT_FOUND' })
      }

      try {
        const jobId = await enqueueSyncWooStock(productId)
        return reply.send({ ok: true, jobId: jobId ?? null })
      } catch (err) {
        request.log.warn({ err, productId }, '[sync-woo-stock] Failed to enqueue')
        return reply.status(500).send({ error: 'Failed to enqueue sync job', code: 'ENQUEUE_FAILED' })
      }
    },
  )
}
