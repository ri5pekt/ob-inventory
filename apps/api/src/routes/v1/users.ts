import type { FastifyPluginAsync } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../../db.js'
import { users } from '@ob-inventory/db'
import { isValidUuid } from './_util.js'

// Metadata only — passwordHash is never selected or exposed here.
const userColumns = {
  id:        users.id,
  name:      users.name,
  email:     users.email,
  role:      users.role,
  isActive:  users.isActive,
  createdAt: users.createdAt,
}

export const usersV1Routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/users', async () => {
    const rows = await db.select(userColumns).from(users).orderBy(users.name)
    return { data: rows }
  })

  fastify.get<{ Params: { id: string } }>('/api/v1/users/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) return reply.status(400).send({ error: 'Invalid id', code: 'VALIDATION_ERROR' })

    const [user] = await db.select(userColumns).from(users).where(eq(users.id, request.params.id))
    if (!user) return reply.status(404).send({ error: 'User not found', code: 'NOT_FOUND' })
    return { data: user }
  })
}
