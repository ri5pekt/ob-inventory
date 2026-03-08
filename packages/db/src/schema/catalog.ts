import {
  pgTable, uuid, text, boolean, integer, numeric, timestamp, pgEnum, primaryKey, unique, date,
} from 'drizzle-orm/pg-core'
import { users } from './auth.js'

export const attributeInputTypeEnum = pgEnum('attribute_input_type', ['select', 'text', 'number'])

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const attributeDefinitions = pgTable('attribute_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  inputType: attributeInputTypeEnum('input_type').notNull(),
  isRequired: boolean('is_required').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const attributeOptions = pgTable('attribute_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  definitionId: uuid('definition_id').notNull().references(() => attributeDefinitions.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [
  unique('attribute_options_def_code_unique').on(t.definitionId, t.code),
])

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  brandId: uuid('brand_id').references(() => brands.id),
  categoryId: uuid('category_id').references(() => categories.id),
  dateAdded: date('date_added', { mode: 'string' }),
  picture: text('picture'),
  basePrice: numeric('base_price', { precision: 10, scale: 2 }),
  wooProductId: integer('woo_product_id'),
  wooTitle: text('woo_title'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
})

export const productAttributes = pgTable('product_attributes', {
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  definitionId: uuid('definition_id').notNull().references(() => attributeDefinitions.id),
  optionId: uuid('option_id').references(() => attributeOptions.id),
  valueText: text('value_text'),
  valueNumber: numeric('value_number'),
}, (t) => [
  primaryKey({ columns: [t.productId, t.definitionId] }),
])
