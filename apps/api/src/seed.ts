/**
 * Seed initial data — run once after first migration.
 * Usage (inside container): node apps/api/dist/seed.js
 */
import { createDb } from '@ob-inventory/db'
import { users, stores } from '@ob-inventory/db'
import argon2 from 'argon2'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1) }

const db = createDb(DATABASE_URL)

console.log('Seeding...')

const passwordHash = await argon2.hash('admin123')

await db.insert(users).values({
  email: 'admin@local',
  passwordHash,
  name:  'Admin',
  role:  'admin',
  isActive: true,
}).onConflictDoNothing()

await db.insert(stores).values({
  name:     'Active Brands',
  url:      'https://activebrands.co.il',
  platform: 'woocommerce',
  isActive: true,
}).onConflictDoNothing()

console.log('✅  admin@local / admin123')
console.log('✅  Store: Active Brands')

process.exit(0)
