/**
 * Standalone migration runner — executed once at deploy time.
 * Usage (inside container): node apps/api/dist/migrate.js
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate }  from 'drizzle-orm/postgres-js/migrator'
import postgres     from 'postgres'
import path         from 'node:path'
import { fileURLToPath } from 'node:url'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// In the built image this file lives at apps/api/dist/migrate.js
// Migration folder is copied to apps/api/dist/migrations/
const migrationsFolder = path.join(__dirname, 'migrations')

console.log('Running migrations from', migrationsFolder)

const client = postgres(DATABASE_URL, { max: 1 })
const db     = drizzle(client)

try {
  await migrate(db, { migrationsFolder })
  console.log('Migrations complete.')
} catch (err) {
  console.error('Migration failed:', err)
  process.exit(1)
} finally {
  await client.end()
}
