import { pgTable, uuid, text, integer, bigint, timestamp } from 'drizzle-orm/pg-core'
import { sales } from './sales.js'

export const cardcomDocuments = pgTable('cardcom_documents', {
  id:             uuid('id').primaryKey().defaultRandom(),
  saleId:         uuid('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  documentType:   text('document_type').notNull(),
  documentNumber: integer('document_number').notNull(),
  // Populated only for terminal charges (chargeCard flow)
  transactionId:  bigint('transaction_id', { mode: 'number' }),
  last4Digits:    text('last4_digits'),
  cardBrand:      text('card_brand'),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
