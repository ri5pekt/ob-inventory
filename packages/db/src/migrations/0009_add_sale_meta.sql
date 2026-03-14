-- Sale targets (e.g. "Amazon", "Local Shop", "B2B Client")
CREATE TABLE IF NOT EXISTS "sale_targets" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name"       text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sale_targets_name_unique" UNIQUE("name")
);
--> statement-breakpoint

-- Sale invoice statuses (e.g. "Paid", "Pending", "Sent", "Overdue")
CREATE TABLE IF NOT EXISTS "sale_invoice_statuses" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name"       text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sale_invoice_statuses_name_unique" UNIQUE("name")
);
--> statement-breakpoint

-- Add target + invoice status columns to sales
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "target_id"          uuid REFERENCES "sale_targets"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "invoice_status_id"  uuid REFERENCES "sale_invoice_statuses"("id") ON DELETE SET NULL;
