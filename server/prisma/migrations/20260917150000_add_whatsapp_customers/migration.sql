-- CreateTable
CREATE TABLE "customers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "whatsapp_phone" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customers_whatsapp_phone_check"
    CHECK ("whatsapp_phone" ~ '^[0-9]+$')
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_business_id_whatsapp_phone_unique"
  ON "customers"("business_id", "whatsapp_phone");

-- AddForeignKey
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
