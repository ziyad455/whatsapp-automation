-- Sprint 11 tenant-scoped lead tracking and canonical message evidence.
CREATE TYPE "lead_status" AS ENUM ('NEW', 'INTERESTED', 'QUALIFIED', 'WON', 'LOST');
CREATE TYPE "lead_intent" AS ENUM (
  'INFORMATION',
  'PURCHASE_INTEREST',
  'BOOKING_INTEREST',
  'COMPLAINT',
  'SUPPORT'
);
CREATE TYPE "lead_status_source" AS ENUM ('AUTOMATIC', 'MANUAL');
CREATE TYPE "lead_evidence_type" AS ENUM (
  'PURCHASE_INTENT',
  'BOOKING_INTENT',
  'ITEM_OR_SERVICE',
  'DATE_OR_TIME',
  'BUDGET',
  'QUANTITY_OR_DURATION',
  'COMMITMENT'
);

ALTER TYPE "audit_target_type" ADD VALUE 'LEAD';
ALTER TYPE "audit_action" ADD VALUE 'STATUS_CHANGE';

CREATE UNIQUE INDEX "conversations_business_id_customer_id_unique"
  ON "conversations"("business_id", "id", "customer_id");
CREATE UNIQUE INDEX "conversation_messages_business_conversation_id_unique"
  ON "conversation_messages"("business_id", "conversation_id", "id");

CREATE TABLE "leads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "status" "lead_status" NOT NULL DEFAULT 'NEW',
  "intent" "lead_intent" NOT NULL,
  "status_source" "lead_status_source" NOT NULL DEFAULT 'AUTOMATIC',
  "summary" TEXT,
  "summary_details" JSONB,
  "summary_updated_at" TIMESTAMPTZ(6),
  "status_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leads_business_id_id_unique"
  ON "leads"("business_id", "id");
CREATE UNIQUE INDEX "leads_business_id_conversation_id_unique"
  ON "leads"("business_id", "id", "conversation_id");
CREATE UNIQUE INDEX "leads_one_active_per_business_conversation_unique"
  ON "leads"("business_id", "conversation_id")
  WHERE "status" IN ('NEW', 'INTERESTED', 'QUALIFIED');
CREATE INDEX "leads_business_status_activity_index"
  ON "leads"("business_id", "status", "last_activity_at" DESC);
CREATE INDEX "leads_business_customer_activity_index"
  ON "leads"("business_id", "customer_id", "last_activity_at" DESC);
CREATE INDEX "leads_business_conversation_index"
  ON "leads"("business_id", "conversation_id");

CREATE TABLE "lead_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "evidence_types" "lead_evidence_type"[] NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lead_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_evidence_business_lead_message_unique"
  ON "lead_evidence"("business_id", "lead_id", "message_id");
CREATE INDEX "lead_evidence_business_lead_created_index"
  ON "lead_evidence"("business_id", "lead_id", "created_at");
CREATE INDEX "lead_evidence_business_conversation_message_index"
  ON "lead_evidence"("business_id", "conversation_id", "message_id");

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "leads_business_customer_fkey"
  FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "leads_business_conversation_customer_fkey"
  FOREIGN KEY ("business_id", "conversation_id", "customer_id") REFERENCES "conversations"("business_id", "id", "customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lead_evidence"
  ADD CONSTRAINT "lead_evidence_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_evidence_business_lead_conversation_fkey"
  FOREIGN KEY ("business_id", "lead_id", "conversation_id") REFERENCES "leads"("business_id", "id", "conversation_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "lead_evidence_business_conversation_message_fkey"
  FOREIGN KEY ("business_id", "conversation_id", "message_id") REFERENCES "conversation_messages"("business_id", "conversation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
