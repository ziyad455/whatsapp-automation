CREATE TYPE "ai_usage_operation" AS ENUM ('CUSTOMER_SERVICE', 'LEAD_SUMMARY');
CREATE TYPE "ai_usage_status" AS ENUM ('SUCCESS', 'FAILED');

ALTER TABLE "conversations" ADD COLUMN "attention_since" TIMESTAMPTZ(6);
UPDATE "conversations"
  SET "attention_since" = "last_activity_at"
  WHERE "mode" = 'HUMAN' AND "status" = 'OPEN';

CREATE INDEX "conversations_business_attention_index"
  ON "conversations"("business_id", "mode", "status", "attention_since");

CREATE INDEX "conversation_messages_business_created_index"
  ON "conversation_messages"("business_id", "created_at" DESC);
CREATE INDEX "leads_business_created_index"
  ON "leads"("business_id", "created_at" DESC);
CREATE INDEX "follow_ups_business_status_scheduled_index"
  ON "follow_ups"("business_id", "status", "scheduled_at");
CREATE INDEX "audit_events_business_target_action_created_index"
  ON "audit_events"("business_id", "target_type", "action", "created_at" DESC);

CREATE TABLE "ai_usage_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "conversation_id" UUID,
  "lead_id" UUID,
  "operation" "ai_usage_operation" NOT NULL,
  "provider" VARCHAR(80) NOT NULL,
  "model" TEXT NOT NULL,
  "status" "ai_usage_status" NOT NULL,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "total_tokens" INTEGER,
  "estimated_cost_usd" DECIMAL(18,8),
  "currency" VARCHAR(3),
  "duration_ms" INTEGER NOT NULL,
  "error_code" VARCHAR(100),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_usage_records_business_occurred_index"
  ON "ai_usage_records"("business_id", "occurred_at" DESC);
CREATE INDEX "ai_usage_records_business_operation_occurred_index"
  ON "ai_usage_records"("business_id", "operation", "occurred_at" DESC);
CREATE INDEX "ai_usage_records_business_model_occurred_index"
  ON "ai_usage_records"("business_id", "model", "occurred_at" DESC);

ALTER TABLE "ai_usage_records"
  ADD CONSTRAINT "ai_usage_records_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "ai_usage_records_conversation_fkey" FOREIGN KEY ("business_id", "conversation_id") REFERENCES "conversations"("business_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ai_usage_records_lead_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT;
