-- CreateEnum
CREATE TYPE "business_weekday" AS ENUM (
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY'
);

-- AlterTable
ALTER TABLE "businesses"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "supported_languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "business_opening_hours" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "day_of_week" "business_weekday" NOT NULL,
  "is_open" BOOLEAN NOT NULL DEFAULT false,
  "opens_at" VARCHAR(5),
  "closes_at" VARCHAR(5),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "business_opening_hours_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_opening_hours_times_check" CHECK (
    ("is_open" = false AND "opens_at" IS NULL AND "closes_at" IS NULL)
    OR
    ("is_open" = true AND "opens_at" IS NOT NULL AND "closes_at" IS NOT NULL AND "opens_at" < "closes_at")
  )
);

-- CreateTable
CREATE TABLE "business_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "category" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "business_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_opening_hours_business_id_day_unique"
  ON "business_opening_hours"("business_id", "day_of_week");

-- CreateIndex
CREATE INDEX "business_rules_business_id_active_index"
  ON "business_rules"("business_id", "active");

-- AddForeignKey
ALTER TABLE "business_opening_hours"
  ADD CONSTRAINT "business_opening_hours_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_rules"
  ADD CONSTRAINT "business_rules_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
