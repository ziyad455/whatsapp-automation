-- CreateEnum
CREATE TYPE "whatsapp_connection_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "whatsapp_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "phone_number_id" VARCHAR(100) NOT NULL,
  "whatsapp_business_account_id" VARCHAR(100) NOT NULL,
  "display_phone_number" TEXT,
  "status" "whatsapp_connection_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "whatsapp_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_connections_phone_number_id_check"
    CHECK ("phone_number_id" ~ '^[0-9]+$'),
  CONSTRAINT "whatsapp_connections_whatsapp_business_account_id_check"
    CHECK ("whatsapp_business_account_id" ~ '^[0-9]+$')
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_connections_phone_number_id_unique"
  ON "whatsapp_connections"("phone_number_id");

-- CreateIndex
CREATE INDEX "whatsapp_connections_business_id_status_index"
  ON "whatsapp_connections"("business_id", "status");

-- AddForeignKey
ALTER TABLE "whatsapp_connections"
  ADD CONSTRAINT "whatsapp_connections_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
