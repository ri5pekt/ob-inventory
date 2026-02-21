import { createDb } from '@ob-inventory/db'
import { env } from './env.js'

export const db = createDb(env.DATABASE_URL)
