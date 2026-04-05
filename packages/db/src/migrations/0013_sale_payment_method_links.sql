-- Junction table: one sale can have multiple payment methods
CREATE TABLE IF NOT EXISTS "sale_payment_method_links" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sale_id"           uuid NOT NULL,
  "payment_method_id" uuid NOT NULL,
  CONSTRAINT "sale_payment_method_links_sale_id_method_id_unique" UNIQUE("sale_id", "payment_method_id"),
  CONSTRAINT "sale_payment_method_links_sale_fk"   FOREIGN KEY ("sale_id")           REFERENCES "sales"("id")                ON DELETE CASCADE,
  CONSTRAINT "sale_payment_method_links_method_fk" FOREIGN KEY ("payment_method_id") REFERENCES "sale_payment_methods"("id") ON DELETE CASCADE
);
--> statement-breakpoint

-- Migrate existing single payment_method_id values into the new junction table
INSERT INTO "sale_payment_method_links" ("sale_id", "payment_method_id")
SELECT "id", "payment_method_id" FROM "sales" WHERE "payment_method_id" IS NOT NULL;
--> statement-breakpoint

-- Drop the old single-value column (data already migrated above)
ALTER TABLE "sales" DROP COLUMN IF EXISTS "payment_method_id";
