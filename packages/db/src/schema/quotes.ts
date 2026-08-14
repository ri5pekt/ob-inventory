import { pgTable, uuid, text, integer, numeric, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { warehouses } from './inventory.js'
import { products } from './catalog.js'
import { users } from './auth.js'
import { sales } from './sales.js'

export const quoteStatusEnum = pgEnum('quote_status', ['open', 'converted', 'cancelled'])

export const quotes = pgTable('quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  quoteNumber: integer('quote_number').notNull().default(sql`DEFAULT`),
  status: quoteStatusEnum('status').notNull().default('open'),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
  customerName: text('customer_name'),
  customerEmail: text('customer_email'),
  customerPhone: text('customer_phone'),
  customerAddress: text('customer_address'),
  customerIdNumber: text('customer_id_number'),
  totalPrice: numeric('total_price', { precision: 10, scale: 2 }),
  currency: text('currency').notNull().default('ILS'),
  notes: text('notes'),
  quoteDate: timestamp('quote_date', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  convertedSaleId: uuid('converted_sale_id').references(() => sales.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
})

export const quoteItems = pgTable('quote_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  quoteId: uuid('quote_id').notNull().references(() => quotes.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').references(() => products.id),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: numeric('unit_price', { precision: 10, scale: 2 }),
  lineTotal: numeric('line_total', { precision: 10, scale: 2 }),
})
