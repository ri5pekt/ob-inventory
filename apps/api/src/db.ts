import { createDb, type Db } from '@ob-inventory/db'
import { env } from './env.js'

export const db: Db = createDb(env.DATABASE_URL)
