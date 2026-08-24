-- CreateEnum
CREATE TYPE "business_lifecycle_status" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "default_language" TEXT NOT NULL,
    "lifecycle_status" "business_lifecycle_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "businesses_name_not_empty" CHECK ("name" = btrim("name") AND length("name") > 0),
    CONSTRAINT "businesses_category_canonical" CHECK ("category" ~ '^[A-Z][A-Z0-9_]*$'),
    CONSTRAINT "businesses_timezone_not_empty" CHECK ("timezone" = btrim("timezone") AND length("timezone") > 0),
    CONSTRAINT "businesses_currency_iso_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "businesses_default_language_normalized" CHECK (
        "default_language" ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'
    )
);
