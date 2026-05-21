ALTER TABLE "cardcom_documents" ADD COLUMN IF NOT EXISTS "transaction_id" bigint;
ALTER TABLE "cardcom_documents" ADD COLUMN IF NOT EXISTS "last4_digits" text;
ALTER TABLE "cardcom_documents" ADD COLUMN IF NOT EXISTS "card_brand" text;
