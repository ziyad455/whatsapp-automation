-- Conversation control and canonical message metadata.
CREATE TYPE "conversation_mode" AS ENUM ('AI', 'HUMAN', 'PAUSED');
CREATE TYPE "conversation_status" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "conversation_handoff_reason" AS ENUM (
  'CUSTOMER_REQUEST',
  'LOW_CONFIDENCE',
  'PURCHASE_INTENT',
  'COMPLAINT',
  'MANUAL'
);
CREATE TYPE "conversation_message_direction" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "conversation_message_sender_type" AS ENUM ('CUSTOMER', 'AI', 'HUMAN', 'SYSTEM');

ALTER TYPE "audit_target_type" ADD VALUE 'CONVERSATION';
ALTER TYPE "audit_action" ADD VALUE 'MODE_CHANGE';

-- Tenant-compatible alternate key for assignment and human-sender relations.
CREATE UNIQUE INDEX "business_users_business_id_id_unique"
  ON "business_users"("business_id", "id");

ALTER TABLE "conversations"
  RENAME COLUMN "last_message_at" TO "last_activity_at";

ALTER TABLE "conversations"
  ADD COLUMN "customer_id" UUID,
  ADD COLUMN "whatsapp_connection_id" UUID,
  ADD COLUMN "mode" "conversation_mode" NOT NULL DEFAULT 'AI',
  ADD COLUMN "status" "conversation_status" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "assigned_business_user_id" UUID,
  ADD COLUMN "handoff_reason" "conversation_handoff_reason",
  ADD COLUMN "control_version" INTEGER NOT NULL DEFAULT 0;

-- Existing WhatsApp conversation participant keys are customer UUIDs.
UPDATE "conversations" AS conversation
SET "customer_id" = customer."id"
FROM "customers" AS customer
WHERE conversation."channel" = 'WHATSAPP'
  AND conversation."business_id" = customer."business_id"
  AND conversation."participant_key" = customer."id"::text;

-- Preserve the most recently used receiving connection for an existing customer thread.
UPDATE "conversations" AS conversation
SET "whatsapp_connection_id" = latest."whatsapp_connection_id"
FROM (
  SELECT DISTINCT ON ("business_id", "customer_id")
    "business_id",
    "customer_id",
    "whatsapp_connection_id"
  FROM "whatsapp_messages"
  ORDER BY "business_id", "customer_id", "created_at" DESC, "id" DESC
) AS latest
WHERE conversation."channel" = 'WHATSAPP'
  AND conversation."business_id" = latest."business_id"
  AND conversation."customer_id" = latest."customer_id";

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_channel_identity_check" CHECK (
    (
      "channel" = 'WHATSAPP'
      AND "customer_id" IS NOT NULL
      AND "whatsapp_connection_id" IS NOT NULL
    )
    OR
    (
      "channel" = 'DASHBOARD'
      AND "customer_id" IS NULL
      AND "whatsapp_connection_id" IS NULL
    )
  );

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_handoff_state_check" CHECK (
    ("mode" = 'AI' AND "handoff_reason" IS NULL AND "assigned_business_user_id" IS NULL)
    OR "mode" = 'HUMAN'
    OR ("mode" = 'PAUSED' AND "handoff_reason" IS NULL AND "assigned_business_user_id" IS NULL)
  );

DROP INDEX "conversations_business_id_last_message_at_index";

CREATE UNIQUE INDEX "conversations_business_channel_customer_unique"
  ON "conversations"("business_id", "channel", "customer_id");

CREATE INDEX "conversations_business_last_activity_index"
  ON "conversations"("business_id", "last_activity_at" DESC);

CREATE INDEX "conversations_business_mode_status_activity_index"
  ON "conversations"("business_id", "mode", "status", "last_activity_at" DESC);

CREATE INDEX "conversations_business_assignment_activity_index"
  ON "conversations"("business_id", "assigned_business_user_id", "last_activity_at" DESC);

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_business_customer_fkey"
  FOREIGN KEY ("business_id", "customer_id")
  REFERENCES "customers"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_business_whatsapp_connection_fkey"
  FOREIGN KEY ("business_id", "whatsapp_connection_id")
  REFERENCES "whatsapp_connections"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_business_assignment_fkey"
  FOREIGN KEY ("business_id", "assigned_business_user_id")
  REFERENCES "business_users"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversation_messages"
  ADD COLUMN "direction" "conversation_message_direction",
  ADD COLUMN "sender_type" "conversation_message_sender_type",
  ADD COLUMN "sent_by_business_user_id" UUID;

UPDATE "conversation_messages"
SET
  "direction" = CASE
    WHEN "role" = 'CUSTOMER' THEN 'INBOUND'::"conversation_message_direction"
    ELSE 'OUTBOUND'::"conversation_message_direction"
  END,
  "sender_type" = CASE
    WHEN "role" = 'CUSTOMER' THEN 'CUSTOMER'::"conversation_message_sender_type"
    ELSE 'AI'::"conversation_message_sender_type"
  END;

ALTER TABLE "conversation_messages"
  ALTER COLUMN "direction" SET NOT NULL,
  ALTER COLUMN "sender_type" SET NOT NULL,
  DROP COLUMN "role";

DROP TYPE "conversation_message_role";

CREATE UNIQUE INDEX "conversation_messages_business_id_id_unique"
  ON "conversation_messages"("business_id", "id");

ALTER TABLE "conversation_messages"
  ADD CONSTRAINT "conversation_messages_direction_sender_check" CHECK (
    ("direction" = 'INBOUND' AND "sender_type" = 'CUSTOMER' AND "sent_by_business_user_id" IS NULL)
    OR
    ("direction" = 'OUTBOUND' AND "sender_type" IN ('AI', 'SYSTEM') AND "sent_by_business_user_id" IS NULL)
    OR
    ("direction" = 'OUTBOUND' AND "sender_type" = 'HUMAN' AND "sent_by_business_user_id" IS NOT NULL)
  );

ALTER TABLE "conversation_messages"
  ADD CONSTRAINT "conversation_messages_business_sender_fkey"
  FOREIGN KEY ("business_id", "sent_by_business_user_id")
  REFERENCES "business_users"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "whatsapp_messages"
  ADD COLUMN "conversation_message_id" UUID;

CREATE UNIQUE INDEX "whatsapp_messages_business_conversation_message_unique"
  ON "whatsapp_messages"("business_id", "conversation_message_id");

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_business_conversation_message_fkey"
  FOREIGN KEY ("business_id", "conversation_message_id")
  REFERENCES "conversation_messages"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
