import { pgTable, uuid, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { warehouses } from './inventory.js'
import { products } from './catalog.js'
import { users } from './auth.js'

export const transferStatusEnum = pgEnum('transfer_status', ['completed', 'cancelled'])

export const transfers = pgTable('transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromWarehouseId: uuid('from_warehouse_id').notNull().references(() => warehouses.id),
  toWarehouseId: uuid('to_warehouse_id').notNull().references(() => warehouses.id),
  status: transferStatusEnum('status').notNull().default('completed'),
  reference: text('reference'),
  notes: text('notes'),
  createdBy:    uuid('created_by').references(() => users.id),
  transferDate: timestamp('transfer_date', { withTimezone: true }).defaultNow().notNull(),
  createdAt:    timestamp('created_at',    { withTimezone: true }).defaultNow().notNull(),
})

export const transferItems = pgTable('transfer_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  transferId: uuid('transfer_id').notNull().references(() => transfers.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id),
  /** Snapshot of SKU/name at transfer time */
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  quantity: integer('quantity').notNull(),
})
