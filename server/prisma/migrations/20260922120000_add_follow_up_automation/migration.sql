CREATE TYPE "follow_up_status" AS ENUM ('PENDING', 'PROCESSING', 'SENDING', 'SENT', 'CANCELLED', 'FAILED');
CREATE TYPE "follow_up_type" AS ENUM ('INITIAL');
ALTER TYPE "audit_target_type" ADD VALUE 'CUSTOMER';

ALTER TABLE "businesses"
  ADD COLUMN "follow_ups_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "initial_follow_up_delay_minutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "follow_up_window_start_minutes" INTEGER NOT NULL DEFAULT 540,
  ADD COLUMN "follow_up_window_end_minutes" INTEGER NOT NULL DEFAULT 1200,
  ADD COLUMN "max_follow_ups_per_lead" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "minimum_follow_up_interval_minutes" INTEGER NOT NULL DEFAULT 1440,
  ADD CONSTRAINT "businesses_follow_up_policy_check" CHECK (
    "initial_follow_up_delay_minutes" BETWEEN 5 AND 10080
    AND "follow_up_window_start_minutes" BETWEEN 0 AND 1439
    AND "follow_up_window_end_minutes" BETWEEN 0 AND 1439
    AND "follow_up_window_start_minutes" <> "follow_up_window_end_minutes"
    AND "max_follow_ups_per_lead" BETWEEN 1 AND 3
    AND "minimum_follow_up_interval_minutes" BETWEEN 60 AND 10080
  );

ALTER TABLE "customers"
  ADD COLUMN "follow_up_consent_at" TIMESTAMPTZ(6),
  ADD COLUMN "follow_up_opted_out_at" TIMESTAMPTZ(6),
  ADD COLUMN "follow_up_consent_recorded_by_id" UUID;

CREATE TABLE "follow_ups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "lead_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "conversation_message_id" UUID,
  "type" "follow_up_type" NOT NULL DEFAULT 'INITIAL',
  "status" "follow_up_status" NOT NULL DEFAULT 'PENDING',
  "content" TEXT NOT NULL,
  "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
  "customer_activity_at" TIMESTAMPTZ(6) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMPTZ(6),
  "claimed_at" TIMESTAMPTZ(6),
  "sent_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "reason_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "follow_ups_attempt_count_check" CHECK ("attempt_count" BETWEEN 0 AND 3)
);

CREATE UNIQUE INDEX "follow_ups_business_id_id_unique" ON "follow_ups"("business_id", "id");
CREATE UNIQUE INDEX "follow_ups_business_conversation_message_unique"
  ON "follow_ups"("business_id", "conversation_id", "conversation_message_id");
CREATE UNIQUE INDEX "follow_ups_conversation_message_unique" ON "follow_ups"("conversation_message_id");
CREATE UNIQUE INDEX "follow_ups_one_active_per_lead_type_unique"
  ON "follow_ups"("business_id", "lead_id", "type")
  WHERE "status" IN ('PENDING', 'PROCESSING', 'SENDING');
CREATE INDEX "follow_ups_status_scheduled_at_index" ON "follow_ups"("status", "scheduled_at");
CREATE INDEX "follow_ups_business_customer_sent_index" ON "follow_ups"("business_id", "customer_id", "sent_at");
CREATE INDEX "follow_ups_business_lead_created_index" ON "follow_ups"("business_id", "lead_id", "created_at");

ALTER TABLE "follow_ups"
  ADD CONSTRAINT "follow_ups_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "follow_ups_business_lead_conversation_fkey"
    FOREIGN KEY ("business_id", "lead_id", "conversation_id") REFERENCES "leads"("business_id", "id", "conversation_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "follow_ups_business_conversation_customer_fkey"
    FOREIGN KEY ("business_id", "conversation_id", "customer_id") REFERENCES "conversations"("business_id", "id", "customer_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "follow_ups_business_customer_fkey"
    FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "follow_ups_business_conversation_message_fkey"
    FOREIGN KEY ("business_id", "conversation_id", "conversation_message_id") REFERENCES "conversation_messages"("business_id", "conversation_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
