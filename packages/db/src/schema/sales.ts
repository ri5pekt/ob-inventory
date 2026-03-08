import { pgTable, uuid, text, integer, numeric, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { warehouses } from './inventory.js'
import { stores } from './integrations.js'
import { products } from './catalog.js'
import { users } from './auth.js'

export const saleTypeEnum = pgEnum('sale_type', ['direct', 'partner', 'woocommerce'])
export const saleStatusEnum = pgEnum('sale_status', ['completed', 'cancelled', 'refunded'])

export const sales = pgTable('sales', {
  id: uuid('id').primaryKey().defaultRandom(),
  saleType: saleTypeEnum('sale_type').notNull(),
  status: saleStatusEnum('status').notNull().default('completed'),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
  storeId: uuid('store_id').references(() => stores.id),
  /** WooCommerce order ID — stored as text to accommodate order-number prefixes */
  wooOrderId: text('woo_order_id'),
  customerName: text('customer_name'),
  customerEmail: text('customer_email'),
  customerPhone:   text('customer_phone'),
  customerAddress: text('customer_address'),
  totalPrice: numeric('total_price', { precision: 10, scale: 2 }),
  currency: text('currency').notNull().default('ILS'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
})

export const saleItems = pgTable('sale_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  saleId: uuid('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  /** Nullable — WooCommerce products that don't exist in OB Inventory yet */
  productId: uuid('product_id').references(() => products.id),
  /** Snapshot of SKU at time of sale (never changes even if product is renamed) */
  sku: text('sku').notNull(),
  /** Snapshot of product name at time of sale */
  name: text('name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }),
  lineTotal: numeric('line_total', { precision: 10, scale: 2 }),
})
