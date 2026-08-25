-- CreateEnum
CREATE TYPE "business_field_type" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME', 'SELECT', 'MULTI_SELECT');

-- CreateEnum
CREATE TYPE "business_entity_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "business_entity_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_entity_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_field_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "business_field_type" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "display_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_entities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "entity_type_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "status" "business_entity_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_entities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_entity_types_business_id_key_unique" ON "business_entity_types"("business_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "business_entity_types_business_id_id_unique" ON "business_entity_types"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "business_field_definitions_entity_type_id_key_unique" ON "business_field_definitions"("entity_type_id", "key");

-- CreateIndex
CREATE INDEX "business_entities_entity_type_id_index" ON "business_entities"("entity_type_id");

-- CreateIndex
CREATE INDEX "business_entities_business_id_entity_type_id_index" ON "business_entities"("business_id", "entity_type_id");

-- AddForeignKey
ALTER TABLE "business_entity_types" ADD CONSTRAINT "business_entity_types_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_field_definitions" ADD CONSTRAINT "business_field_definitions_entity_type_id_fkey" FOREIGN KEY ("entity_type_id") REFERENCES "business_entity_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_entities" ADD CONSTRAINT "business_entities_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_entities" ADD CONSTRAINT "business_entities_business_id_entity_type_id_fkey" FOREIGN KEY ("business_id", "entity_type_id") REFERENCES "business_entity_types"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
