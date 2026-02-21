import type { FastifyPluginAsync } from 'fastify'
import { sql } from 'drizzle-orm'
import { db } from '../db.js'
import { redis } from '../redis.js'

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/health', async (_request, reply) => {
    let dbStatus = 'ok'
    let redisStatus = 'ok'

    try {
      await db.execute(sql`SELECT 1`)
    } catch {
      dbStatus = 'error'
    }

    try {
      await redis.ping()
    } catch {
      redisStatus = 'error'
    }

    const allOk = dbStatus === 'ok' && redisStatus === 'ok'
    return reply.status(allOk ? 200 : 503).send({
      status: allOk ? 'ok' : 'error',
      db: dbStatus,
      redis: redisStatus,
    })
  })
}
