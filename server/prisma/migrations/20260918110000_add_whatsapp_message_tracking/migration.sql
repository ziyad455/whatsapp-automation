-- CreateEnum
CREATE TYPE "whatsapp_message_direction" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "whatsapp_inbound_processing_status" AS ENUM (
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'FAILED'
);

-- CreateEnum
CREATE TYPE "whatsapp_delivery_status" AS ENUM (
  'PENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED'
);

-- Add tenant-compatible alternate keys used by composite foreign keys.
CREATE UNIQUE INDEX "whatsapp_connections_business_id_id_unique"
  ON "whatsapp_connections"("business_id", "id");

CREATE UNIQUE INDEX "customers_business_id_id_unique"
  ON "customers"("business_id", "id");

-- CreateTable
CREATE TABLE "whatsapp_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "whatsapp_connection_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "direction" "whatsapp_message_direction" NOT NULL,
  "external_message_id" TEXT,
  "recipient_phone" VARCHAR(100),
  "processing_status" "whatsapp_inbound_processing_status",
  "delivery_status" "whatsapp_delivery_status",
  "provider_timestamp" TIMESTAMPTZ(6),
  "processing_started_at" TIMESTAMPTZ(6),
  "processed_at" TIMESTAMPTZ(6),
  "processing_failed_at" TIMESTAMPTZ(6),
  "sent_at" TIMESTAMPTZ(6),
  "delivered_at" TIMESTAMPTZ(6),
  "read_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "failure_code" VARCHAR(100),
  "failure_title" TEXT,
  "failure_details" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_messages_recipient_phone_check"
    CHECK ("recipient_phone" IS NULL OR "recipient_phone" ~ '^[0-9]+$'),
  CONSTRAINT "whatsapp_messages_direction_state_check" CHECK (
    (
      "direction" = 'INBOUND'
      AND "external_message_id" IS NOT NULL
      AND "processing_status" IS NOT NULL
      AND "delivery_status" IS NULL
      AND "recipient_phone" IS NULL
    )
    OR
    (
      "direction" = 'OUTBOUND'
      AND "processing_status" IS NULL
      AND "delivery_status" IS NOT NULL
      AND "recipient_phone" IS NOT NULL
    )
  )
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_external_message_id_unique"
  ON "whatsapp_messages"("external_message_id");

CREATE INDEX "whatsapp_messages_business_direction_created_index"
  ON "whatsapp_messages"("business_id", "direction", "created_at");

CREATE INDEX "whatsapp_messages_business_delivery_status_index"
  ON "whatsapp_messages"("business_id", "delivery_status");

-- AddForeignKey
ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_business_connection_fkey"
  FOREIGN KEY ("business_id", "whatsapp_connection_id")
  REFERENCES "whatsapp_connections"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_business_customer_fkey"
  FOREIGN KEY ("business_id", "customer_id")
  REFERENCES "customers"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
