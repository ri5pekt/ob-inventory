import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'

export const customers = pgTable('customers', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  email:     text('email'),
  phone:     text('phone'),
  address:   text('address'),
  company:   text('company'),
  idNumber:  text('id_number'),
  notes:     text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
