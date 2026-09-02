ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "converted_from_sale_id" uuid REFERENCES "sales"("id") ON DELETE SET NULL;
ALTER TYPE "woo_sync_action" ADD VALUE IF NOT EXISTS 'cancel_order';
