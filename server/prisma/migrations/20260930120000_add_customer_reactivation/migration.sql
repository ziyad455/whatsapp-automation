CREATE TYPE "customer_lifecycle_event_type" AS ENUM (
  'BOOKING_COMPLETED',
  'PURCHASE_COMPLETED',
  'MEMBERSHIP_STARTED',
  'MEMBERSHIP_EXPIRED',
  'SERVICE_COMPLETED'
);

CREATE TYPE "customer_preference_source" AS ENUM ('STAFF', 'CUSTOMER', 'PROVIDER');
CREATE TYPE "campaign_status" AS ENUM ('DRAFT', 'READY', 'SENDING', 'COMPLETED', 'CANCELLED', 'FAILED');
CREATE TYPE "campaign_recipient_status" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');
CREATE TYPE "campaign_template_status" AS ENUM ('UNVERIFIED', 'APPROVED', 'REJECTED');

ALTER TABLE "customers"
  ADD COLUMN "marketing_consent_at" TIMESTAMPTZ(6),
  ADD COLUMN "marketing_consent_source" "customer_preference_source",
  ADD COLUMN "marketing_consent_evidence" TEXT,
  ADD COLUMN "marketing_opted_out_at" TIMESTAMPTZ(6),
  ADD COLUMN "marketing_opt_out_source" "customer_preference_source";

CREATE UNIQUE INDEX "business_entities_business_id_id_unique"
  ON "business_entities"("business_id", "id");

CREATE TABLE "customer_lifecycle_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "type" "customer_lifecycle_event_type" NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "related_lead_id" UUID,
  "related_conversation_id" UUID,
  "related_entity_id" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_lifecycle_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_lifecycle_events_business_id_id_unique"
  ON "customer_lifecycle_events"("business_id", "id");
CREATE INDEX "customer_lifecycle_events_business_customer_occurred_index"
  ON "customer_lifecycle_events"("business_id", "customer_id", "occurred_at" DESC);
CREATE INDEX "customer_lifecycle_events_business_type_occurred_index"
  ON "customer_lifecycle_events"("business_id", "type", "occurred_at" DESC);

CREATE TABLE "campaigns" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "segment_definition" JSONB NOT NULL,
  "template_name" VARCHAR(512) NOT NULL,
  "template_language" VARCHAR(35) NOT NULL,
  "template_body" TEXT NOT NULL,
  "template_parameters" JSONB NOT NULL DEFAULT '[]',
  "template_status" "campaign_template_status" NOT NULL DEFAULT 'UNVERIFIED',
  "template_category" VARCHAR(50),
  "template_verified_at" TIMESTAMPTZ(6),
  "status" "campaign_status" NOT NULL DEFAULT 'DRAFT',
  "approved_at" TIMESTAMPTZ(6),
  "launched_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "failure_reason_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaigns_business_id_id_unique" ON "campaigns"("business_id", "id");
CREATE INDEX "campaigns_business_status_created_index" ON "campaigns"("business_id", "status", "created_at" DESC);

CREATE TABLE "campaign_recipients" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "conversation_message_id" UUID,
  "conversion_lifecycle_event_id" UUID,
  "status" "campaign_recipient_status" NOT NULL DEFAULT 'PENDING',
  "matched_reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rendered_message" TEXT NOT NULL,
  "exclusion_reason_code" VARCHAR(80),
  "failure_reason_code" VARCHAR(80),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "selected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at" TIMESTAMPTZ(6),
  "sent_at" TIMESTAMPTZ(6),
  "delivered_at" TIMESTAMPTZ(6),
  "read_at" TIMESTAMPTZ(6),
  "replied_at" TIMESTAMPTZ(6),
  "converted_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_recipients_business_id_id_unique" ON "campaign_recipients"("business_id", "id");
CREATE UNIQUE INDEX "campaign_recipients_business_campaign_customer_unique" ON "campaign_recipients"("business_id", "campaign_id", "customer_id");
CREATE UNIQUE INDEX "campaign_recipients_business_conversation_message_unique" ON "campaign_recipients"("business_id", "conversation_message_id");
CREATE INDEX "campaign_recipients_status_claimed_index" ON "campaign_recipients"("status", "claimed_at");
CREATE INDEX "campaign_recipients_business_customer_sent_index" ON "campaign_recipients"("business_id", "customer_id", "sent_at" DESC);
CREATE INDEX "campaign_recipients_business_campaign_status_index" ON "campaign_recipients"("business_id", "campaign_id", "status");

ALTER TABLE "customer_lifecycle_events"
  ADD CONSTRAINT "customer_lifecycle_events_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "customer_lifecycle_events_customer_fkey" FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "customer_lifecycle_events_lead_fkey" FOREIGN KEY ("business_id", "related_lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "customer_lifecycle_events_conversation_fkey" FOREIGN KEY ("business_id", "related_conversation_id") REFERENCES "conversations"("business_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "customer_lifecycle_events_entity_fkey" FOREIGN KEY ("business_id", "related_entity_id") REFERENCES "business_entities"("business_id", "id") ON DELETE RESTRICT;

ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE;

ALTER TABLE "campaign_recipients"
  ADD CONSTRAINT "campaign_recipients_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "campaign_recipients_campaign_fkey" FOREIGN KEY ("business_id", "campaign_id") REFERENCES "campaigns"("business_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "campaign_recipients_customer_fkey" FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "campaign_recipients_message_fkey" FOREIGN KEY ("business_id", "conversation_message_id") REFERENCES "conversation_messages"("business_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "campaign_recipients_conversion_fkey" FOREIGN KEY ("business_id", "conversion_lifecycle_event_id") REFERENCES "customer_lifecycle_events"("business_id", "id") ON DELETE RESTRICT;
