import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core'
import { sales } from './sales.js'

export const cardcomDocuments = pgTable('cardcom_documents', {
  id:             uuid('id').primaryKey().defaultRandom(),
  saleId:         uuid('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  documentType:   text('document_type').notNull(),
  documentNumber: integer('document_number').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
