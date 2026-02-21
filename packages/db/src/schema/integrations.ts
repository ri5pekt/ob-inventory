import { pgTable, uuid, text, integer, jsonb, timestamp, pgEnum, boolean } from 'drizzle-orm/pg-core'
import { products } from './catalog'
import { users } from './auth'

export const storePlatformEnum = pgEnum('store_platform', ['woocommerce', 'direct', 'other'])

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url'),
  platform: storePlatformEnum('platform').notNull().default('woocommerce'),
  secretToken: text('secret_token'),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const wooSyncActionEnum = pgEnum('woo_sync_action', ['push_stock', 'pull_order'])
export const wooSyncStatusEnum = pgEnum('woo_sync_status', ['pending', 'success', 'failed'])

export const wooSyncLog = pgTable('woo_sync_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').references(() => products.id),
  wooProductId: integer('woo_product_id'),
  action: wooSyncActionEnum('action').notNull(),
  status: wooSyncStatusEnum('status').notNull().default('pending'),
  payload: jsonb('payload'),
  response: jsonb('response'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
