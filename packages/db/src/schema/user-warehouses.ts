import { pgTable, uuid, primaryKey } from 'drizzle-orm/pg-core'
import { users } from './auth.js'
import { warehouses } from './inventory.js'

export const userWarehouses = pgTable('user_warehouses', {
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.warehouseId] }),
])
