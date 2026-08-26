-- DropIndex
DROP INDEX "business_entities_business_id_entity_type_id_index";

-- AlterTable
ALTER TABLE "business_field_definitions" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "business_entities_business_id_entity_type_id_status_index" ON "business_entities"("business_id", "entity_type_id", "status");

-- CreateIndex
CREATE INDEX "business_entities_data_gin_index" ON "business_entities" USING GIN ("data" jsonb_path_ops);
