-- Add warehouse_admin value to user_role enum
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'warehouse_admin';

-- Migrate existing staff users to warehouse_admin
UPDATE "users" SET "role" = 'warehouse_admin' WHERE "role" = 'staff';

-- Create user_warehouses join table
CREATE TABLE IF NOT EXISTS "user_warehouses" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
  PRIMARY KEY ("user_id", "warehouse_id")
);
