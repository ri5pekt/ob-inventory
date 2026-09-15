import { pgTable, uuid, text, integer, bigint, numeric, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core'
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

// ── QR / Low Profile payment requests ────────────────────────────────────────
// Tracks a Cardcom "LowProfile" hosted-payment-page request from creation through
// resolution. See docs/CARDCOM_QR_PAYMENT_DEV_PLAN.md for the full design.
export const cardcomLpStatusEnum = pgEnum('cardcom_lp_status', [
  'pending', 'paid', 'failed', 'expired', 'cancelled', 'paid_after_cancel',
])

export const cardcomLowprofileRequests = pgTable('cardcom_lowprofile_requests', {
  id:            uuid('id').primaryKey().defaultRandom(),
  saleId:        uuid('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  lowProfileId:  text('low_profile_id').notNull().unique(), // Cardcom's guid
  amount:        numeric('amount', { precision: 10, scale: 2 }).notNull(),
  status:        cardcomLpStatusEnum('status').notNull().default('pending'),
  url:           text('url').notNull(), // the hosted page URL we render as a QR code
  rawResult:     jsonb('raw_result'),   // last GetLpResult payload — debugging aid
  documentId:    uuid('document_id').references(() => cardcomDocuments.id), // set once paid
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }), // last GetLpResult poll-through, for throttling
  resolvedAt:    timestamp('resolved_at', { withTimezone: true }),
})
