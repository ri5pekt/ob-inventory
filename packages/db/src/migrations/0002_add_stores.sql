CREATE TYPE "public"."store_platform" AS ENUM('woocommerce', 'direct', 'other');--> statement-breakpoint
CREATE TABLE "stores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "url" text,
  "platform" "store_platform" NOT NULL DEFAULT 'woocommerce',
  "is_active" boolean NOT NULL DEFAULT true,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
