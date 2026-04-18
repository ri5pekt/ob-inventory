ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "transfer_date" timestamp with time zone DEFAULT now();
UPDATE "transfers" SET "transfer_date" = "created_at" WHERE "transfer_date" IS NULL;
ALTER TABLE "transfers" ALTER COLUMN "transfer_date" SET NOT NULL;
