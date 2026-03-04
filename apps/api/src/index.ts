import './env.js' // validate env first
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from './env.js'
import { healthRoutes } from './routes/health.js'
import { authRoutes } from './routes/auth.js'
import { warehouseRoutes } from './routes/warehouses.js'
import { warehouseStockRoutes } from './routes/warehouse-stock.js'
import { warehouseProductRoutes } from './routes/warehouse-products.js'
import { storeRoutes } from './routes/stores.js'
import { catalogRoutes } from './routes/catalog.js'
import { salesRoutes } from './routes/sales.js'
import { webhookRoutes } from './routes/webhooks.js'
import { transferRoutes } from './routes/transfers.js'
import { logsRoutes } from './routes/logs.js'
import { productSearchRoutes } from './routes/product-search.js'
import { userRoutes } from './routes/users.js'
import { importRoutes } from './routes/import.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

const fastify = Fastify({
  logger: env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : true,
})

await fastify.register(fastifyCookie)

await fastify.register(fastifyMultipart, {
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max CSV
})

await fastify.register(fastifyStatic, {
  root: join(__dirname, '../uploads'),
  prefix: '/uploads',
  decorateReply: false,
})

await fastify.register(fastifyJwt, {
  secret: env.JWT_SECRET,
})

await fastify.register(fastifyCors, {
  origin: env.NODE_ENV === 'development',
  credentials: true,
})

await fastify.register(fastifyHelmet, {
  contentSecurityPolicy: false,
})

fastify.decorate('authenticate', async function (request: Parameters<typeof fastify.authenticate>[0], reply: Parameters<typeof fastify.authenticate>[1]) {
  try {
    await request.jwtVerify()
  } catch {
    reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
  }
})

await fastify.register(healthRoutes)
await fastify.register(authRoutes)
await fastify.register(warehouseRoutes)
await fastify.register(warehouseStockRoutes)
await fastify.register(warehouseProductRoutes)
await fastify.register(storeRoutes)
await fastify.register(catalogRoutes)
await fastify.register(salesRoutes)
await fastify.register(webhookRoutes)
await fastify.register(transferRoutes)
await fastify.register(logsRoutes)
await fastify.register(productSearchRoutes)
await fastify.register(userRoutes)
await fastify.register(importRoutes)

try {
  await fastify.listen({ port: env.API_PORT, host: '0.0.0.0' })
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
