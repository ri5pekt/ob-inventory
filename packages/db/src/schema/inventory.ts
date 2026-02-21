import {
  pgTable, uuid, text, boolean, integer, timestamp, pgEnum, primaryKey, check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { products } from './catalog'
import { users } from './auth'

export const warehouseTypeEnum = pgEnum('warehouse_type', ['main', 'partner', 'other'])

export const ledgerActionTypeEnum = pgEnum('ledger_action_type', [
  'receive', 'transfer_in', 'transfer_out', 'sale', 'return', 'adjustment',
])

export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: warehouseTypeEnum('type').notNull().default('other'),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  color: text('color').notNull().default('#94a3b8'),
  icon: text('icon').notNull().default('pi-building'),
  logo: text('logo'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const inventoryLedger = pgTable('inventory_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
  actionType: ledgerActionTypeEnum('action_type').notNull(),
  quantityDelta: integer('quantity_delta').notNull(),
  referenceId: uuid('reference_id'),
  referenceType: text('reference_type'),
  supplierRef: text('supplier_ref'),
  dateReceived: timestamp('date_received', { withTimezone: true }),
  reason: text('reason'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const inventoryStock = pgTable('inventory_stock', {
  productId: uuid('product_id').notNull().references(() => products.id),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
  boxNumber: text('box_number'),
  quantity: integer('quantity').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.productId, t.warehouseId] }),
  check('quantity_non_negative', sql`${t.quantity} >= 0`),
])
