CREATE TYPE "cardcom_lp_status" AS ENUM ('pending', 'paid', 'failed', 'expired', 'cancelled', 'paid_after_cancel');

CREATE TABLE IF NOT EXISTS "cardcom_lowprofile_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sale_id" uuid NOT NULL REFERENCES "sales"("id") ON DELETE CASCADE,
  "low_profile_id" text NOT NULL UNIQUE,
  "amount" numeric(10, 2) NOT NULL,
  "status" "cardcom_lp_status" DEFAULT 'pending' NOT NULL,
  "url" text NOT NULL,
  "raw_result" jsonb,
  "document_id" uuid REFERENCES "cardcom_documents"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "last_checked_at" timestamptz,
  "resolved_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "cardcom_lowprofile_requests_sale_id_idx" ON "cardcom_lowprofile_requests" ("sale_id");
CREATE INDEX IF NOT EXISTS "cardcom_lowprofile_requests_status_idx" ON "cardcom_lowprofile_requests" ("status");
