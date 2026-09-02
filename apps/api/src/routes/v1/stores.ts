import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db.js'
import { stores } from '@ob-inventory/db'

// Metadata only — secretToken/Woo API secret are never selected or exposed here.
export const storesV1Routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/stores', async () => {
    const rows = await db
      .select({
        id:        stores.id,
        name:      stores.name,
        url:       stores.url,
        platform:  stores.platform,
        isActive:  stores.isActive,
        notes:     stores.notes,
        createdAt: stores.createdAt,
      })
      .from(stores)
      .orderBy(stores.name)
    return { data: rows }
  })
}
