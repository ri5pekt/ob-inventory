CREATE TABLE IF NOT EXISTS "api_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "token_prefix" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "is_active" boolean DEFAULT true NOT NULL,
  "expires_at" timestamptz,
  "last_used_at" timestamptz,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "revoked_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "api_token_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_id" uuid REFERENCES "api_tokens"("id") ON DELETE CASCADE,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "status_code" integer NOT NULL,
  "ip" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "api_token_requests_token_id_idx" ON "api_token_requests" ("token_id");
CREATE INDEX IF NOT EXISTS "api_token_requests_created_at_idx" ON "api_token_requests" ("created_at");
