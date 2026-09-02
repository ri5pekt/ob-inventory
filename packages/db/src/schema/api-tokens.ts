import { pgTable, uuid, text, boolean, integer, timestamp } from 'drizzle-orm/pg-core'
import { users } from './auth.js'

export const apiTokens = pgTable('api_tokens', {
  id:          uuid('id').primaryKey().defaultRandom(),
  name:        text('name').notNull(),
  tokenPrefix: text('token_prefix').notNull(),
  tokenHash:   text('token_hash').notNull().unique(),
  isActive:    boolean('is_active').notNull().default(true),
  expiresAt:   timestamp('expires_at',  { withTimezone: true }),
  lastUsedAt:  timestamp('last_used_at', { withTimezone: true }),
  createdBy:   uuid('created_by').references(() => users.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt:   timestamp('revoked_at', { withTimezone: true }),
})

// Lightweight usage log for the external /api/v1/* surface — separate from
// audit_log (which is user-centric) since these requests are token-centric.
export const apiTokenRequests = pgTable('api_token_requests', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tokenId:    uuid('token_id').references(() => apiTokens.id, { onDelete: 'cascade' }),
  method:     text('method').notNull(),
  path:       text('path').notNull(),
  statusCode: integer('status_code').notNull(),
  ip:         text('ip'),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
