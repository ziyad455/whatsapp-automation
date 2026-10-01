ALTER TABLE "whatsapp_messages" ADD COLUMN "send_started_at" TIMESTAMPTZ(6);
ALTER TABLE "whatsapp_connections" ADD COLUMN "outbound_blocked_at" TIMESTAMPTZ(6);
-- Existing pending sends may already have reached Meta. Do not replay them.
UPDATE "whatsapp_messages" SET "send_started_at" = "created_at"
WHERE "direction" = 'OUTBOUND' AND "delivery_status" = 'PENDING';

ALTER TABLE "campaign_recipients" ADD COLUMN "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "campaign_recipients_status_next_attempt_index"
ON "campaign_recipients"("status", "next_attempt_at");

ALTER TABLE "customer_lifecycle_events" ADD COLUMN "request_key" UUID;
CREATE UNIQUE INDEX "customer_lifecycle_events_business_request_key_unique"
ON "customer_lifecycle_events"("business_id", "request_key");
