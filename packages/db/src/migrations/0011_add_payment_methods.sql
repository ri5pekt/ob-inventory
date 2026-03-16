-- Sale payment methods (e.g. "Cash", "Credit Card", "Bank Transfer", "PayPal")
CREATE TABLE IF NOT EXISTS "sale_payment_methods" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name"       text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sale_payment_methods_name_unique" UNIQUE("name")
);
--> statement-breakpoint

-- Add payment_method_id column to sales
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "payment_method_id" uuid REFERENCES "sale_payment_methods"("id") ON DELETE SET NULL;
