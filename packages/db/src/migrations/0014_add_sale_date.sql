ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "sale_date" timestamp with time zone DEFAULT now();
UPDATE "sales" SET "sale_date" = "created_at" WHERE "sale_date" IS NULL;
ALTER TABLE "sales" ALTER COLUMN "sale_date" SET NOT NULL;
