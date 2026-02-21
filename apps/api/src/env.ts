import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('365d'),
  API_PORT: z.coerce.number().default(3000),
  WOO_STORE_URL: z.string().optional(),
  WOO_API_KEY: z.string().optional(),
  WOO_API_SECRET: z.string().optional(),
  WOO_WEBHOOK_SECRET: z.string().optional(),
  WOO_PLUGIN_API_KEY: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌  Invalid environment variables:')
  for (const [field, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${field}: ${errors?.join(', ')}`)
  }
  process.exit(1)
}

export const env = parsed.data
