-- Sync DB schema with current TypeScript definitions
-- Adds columns that were added to the schema but never had migrations generated

-- New enums
CREATE TYPE "public"."sale_status" AS ENUM('completed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('completed', 'cancelled');--> statement-breakpoint

-- warehouses: add color, icon, logo
ALTER TABLE "warehouses"
  ADD COLUMN IF NOT EXISTS "color" text NOT NULL DEFAULT '#94a3b8',
  ADD COLUMN IF NOT EXISTS "icon" text NOT NULL DEFAULT 'pi-building',
  ADD COLUMN IF NOT EXISTS "logo" text;--> statement-breakpoint

-- inventory_stock: add box_number
ALTER TABLE "inventory_stock"
  ADD COLUMN IF NOT EXISTS "box_number" text;--> statement-breakpoint

-- products: add woo_title
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "woo_title" text;--> statement-breakpoint

-- transfers: add status and reference
ALTER TABLE "transfers"
  ADD COLUMN IF NOT EXISTS "status" "transfer_status" NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS "reference" text;--> statement-breakpoint

-- transfer_items: add sku and name snapshots
ALTER TABLE "transfer_items"
  ADD COLUMN IF NOT EXISTS "sku" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "name" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "transfer_items" ALTER COLUMN "sku" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transfer_items" ALTER COLUMN "name" DROP DEFAULT;--> statement-breakpoint

-- sale_items: make product_id and unit_price nullable, add sku/name/line_total
ALTER TABLE "sale_items"
  ALTER COLUMN "product_id" DROP NOT NULL,
  ALTER COLUMN "unit_price" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "sku" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "name" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "line_total" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "sku" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "sale_items" ALTER COLUMN "name" DROP DEFAULT;--> statement-breakpoint

-- sales: add new columns (old fulfillment_state/payment_state/invoice_state kept for compatibility)
ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "status" "sale_status" NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS "store_id" uuid REFERENCES "stores"("id"),
  ADD COLUMN IF NOT EXISTS "customer_email" text,
  ADD COLUMN IF NOT EXISTS "customer_phone" text,
  ADD COLUMN IF NOT EXISTS "customer_address" text,
  ADD COLUMN IF NOT EXISTS "total_price" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'ILS';--> statement-breakpoint
