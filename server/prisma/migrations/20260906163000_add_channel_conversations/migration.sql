-- CreateEnum
CREATE TYPE "conversation_channel" AS ENUM ('DASHBOARD', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "conversation_message_role" AS ENUM ('CUSTOMER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "channel" "conversation_channel" NOT NULL,
  "participant_key" TEXT NOT NULL,
  "message_count" INTEGER NOT NULL DEFAULT 0,
  "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversations_participant_key_check"
    CHECK (char_length("participant_key") BETWEEN 1 AND 200)
);

-- CreateTable
CREATE TABLE "conversation_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "role" "conversation_message_role" NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversation_messages_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "conversation_messages_content_check"
    CHECK (char_length("content") BETWEEN 1 AND 4000)
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_business_id_id_unique"
  ON "conversations"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_business_channel_participant_unique"
  ON "conversations"("business_id", "channel", "participant_key");

-- CreateIndex
CREATE INDEX "conversations_business_id_last_message_at_index"
  ON "conversations"("business_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_business_conversation_sequence_unique"
  ON "conversation_messages"("business_id", "conversation_id", "sequence");

-- CreateIndex
CREATE INDEX "conversation_messages_business_conversation_created_index"
  ON "conversation_messages"("business_id", "conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages"
  ADD CONSTRAINT "conversation_messages_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages"
  ADD CONSTRAINT "conversation_messages_business_id_conversation_id_fkey"
  FOREIGN KEY ("business_id", "conversation_id") REFERENCES "conversations"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
