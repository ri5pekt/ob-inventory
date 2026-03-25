-- Add per-warehouse arrival date to inventory_stock.
-- Existing rows get NULL (the stock query falls back to products.date_added for those).
ALTER TABLE inventory_stock ADD COLUMN date_added date;
