-- Add cost_price and retail_price to products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cost_price"   numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "retail_price" numeric(10, 2);
