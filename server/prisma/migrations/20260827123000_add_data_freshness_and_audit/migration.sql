-- CreateEnum
CREATE TYPE "data_source" AS ENUM ('MANUAL', 'IMPORT', 'API', 'SYNC', 'SYSTEM');

-- CreateEnum
CREATE TYPE "freshness_class" AS ENUM ('STABLE', 'CHANGING', 'REAL_TIME');

-- CreateEnum
CREATE TYPE "audit_actor_kind" AS ENUM ('USER', 'SYSTEM', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "audit_target_type" AS ENUM (
  'BUSINESS_PROFILE',
  'OPENING_HOURS',
  'BUSINESS_RULE',
  'BUSINESS_ENTITY_TYPE',
  'BUSINESS_FIELD_DEFINITION',
  'BUSINESS_ENTITY'
);

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM (
  'CREATE',
  'UPDATE',
  'ARCHIVE',
  'RESTORE',
  'SCHEMA_CHANGE',
  'VERIFY'
);

-- Add provenance for the factual business profile fields stored on the tenant root.
ALTER TABLE "businesses"
  ADD COLUMN "profile_source" "data_source" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "profile_external_id" TEXT,
  ADD COLUMN "profile_last_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "profile_freshness_class" "freshness_class" NOT NULL DEFAULT 'STABLE',
  ADD COLUMN "profile_stale_after_seconds" INTEGER;

-- Add record-level provenance and freshness for regular opening-hour facts.
ALTER TABLE "business_opening_hours"
  ADD COLUMN "source" "data_source" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "external_id" TEXT,
  ADD COLUMN "last_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "freshness_class" "freshness_class" NOT NULL DEFAULT 'CHANGING',
  ADD COLUMN "stale_after_seconds" INTEGER;

-- Add record-level provenance and freshness for business rules.
ALTER TABLE "business_rules"
  ADD COLUMN "source" "data_source" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "external_id" TEXT,
  ADD COLUMN "last_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "freshness_class" "freshness_class" NOT NULL DEFAULT 'STABLE',
  ADD COLUMN "stale_after_seconds" INTEGER;

-- Dynamic fields own volatility and TTL while entity records own source and verification time.
ALTER TABLE "business_field_definitions"
  ADD COLUMN "freshness_class" "freshness_class" NOT NULL DEFAULT 'CHANGING',
  ADD COLUMN "stale_after_seconds" INTEGER;

ALTER TABLE "business_entities"
  ADD COLUMN "source" "data_source" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "external_id" TEXT,
  ADD COLUMN "last_verified_at" TIMESTAMPTZ(6);

ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_profile_stale_after_seconds_check"
  CHECK ("profile_stale_after_seconds" IS NULL OR "profile_stale_after_seconds" >= 0);

ALTER TABLE "business_opening_hours"
  ADD CONSTRAINT "business_opening_hours_stale_after_seconds_check"
  CHECK ("stale_after_seconds" IS NULL OR "stale_after_seconds" >= 0);

ALTER TABLE "business_rules"
  ADD CONSTRAINT "business_rules_stale_after_seconds_check"
  CHECK ("stale_after_seconds" IS NULL OR "stale_after_seconds" >= 0);

ALTER TABLE "business_field_definitions"
  ADD CONSTRAINT "business_field_definitions_stale_after_seconds_check"
  CHECK ("stale_after_seconds" IS NULL OR "stale_after_seconds" >= 0);

-- CreateTable
CREATE TABLE "audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "actor_kind" "audit_actor_kind" NOT NULL,
  "target_type" "audit_target_type" NOT NULL,
  "target_id" UUID NOT NULL,
  "action" "audit_action" NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_business_id_created_at_index"
  ON "audit_events"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_business_target_created_at_index"
  ON "audit_events"("business_id", "target_type", "target_id", "created_at");

-- AddForeignKey
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
