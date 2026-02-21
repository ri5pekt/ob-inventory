import { createDb, users, stores } from '../packages/db/src/index.js'
import argon2 from 'argon2'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://ob_user:changeme@localhost:5432/ob_inventory'

const db = createDb(DATABASE_URL)

async function seed() {
  console.log('Seeding database...')

  const passwordHash = await argon2.hash('admin123')

  await db
    .insert(users)
    .values({
      email: 'admin@local',
      passwordHash,
      name: 'Admin',
      role: 'admin',
      isActive: true,
    })
    .onConflictDoNothing()

  await db
    .insert(stores)
    .values({
      name: 'Active Brands',
      url: 'https://activebrands.co.il',
      platform: 'woocommerce',
      isActive: true,
    })
    .onConflictDoNothing()

  console.log('')
  console.log('✅  Admin user ready:')
  console.log('    Email:    admin@local')
  console.log('    Password: admin123')
  console.log('')
  console.log('✅  Store seeded: Active Brands (https://activebrands.co.il)')
  console.log('')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
