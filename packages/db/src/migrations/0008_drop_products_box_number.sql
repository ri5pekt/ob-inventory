-- Drop products.box_number (moved to inventory_stock in 0007)
-- box_number is now per-warehouse in inventory_stock, not per-product
ALTER TABLE "products" DROP COLUMN IF EXISTS "box_number";
