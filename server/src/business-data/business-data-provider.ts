import type {
  BusinessEntityStatus,
  BusinessFieldType,
  BusinessWeekday,
  DataSource,
  FreshnessClass,
  Prisma,
} from '../generated/prisma/client';
import type { SearchBusinessEntitiesInput } from './tenant-business-entity-query.service';
import type { FreshnessStatus } from './freshness';

export interface CurrentFactMetadata {
  source: DataSource;
  externalId: string | null;
  freshnessClass: FreshnessClass;
  lastVerifiedAt: Date | null;
  staleAfterSeconds: number | null;
  freshnessStatus: FreshnessStatus;
  isStale: boolean | null;
}

export interface CurrentBusinessProfile {
  id: string;
  name: string;
  category: string;
  description: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  defaultLanguage: string;
  supportedLanguages: string[];
  metadata: CurrentFactMetadata;
}

export interface CurrentOpeningHour {
  id: string;
  dayOfWeek: BusinessWeekday;
  isOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
  metadata: CurrentFactMetadata;
}

export interface CurrentBusinessRule {
  id: string;
  category: string;
  name: string;
  content: string;
  metadata: CurrentFactMetadata;
}

export interface CurrentBusinessEntityType {
  id: string;
  key: string;
  name: string;
  description: string | null;
  schemaVersion: number;
  fieldCount: number;
}

export interface CurrentBusinessEntityField {
  definitionId: string;
  key: string;
  label: string;
  type: BusinessFieldType;
  value: Prisma.JsonValue | null;
  hasValue: boolean;
  metadata: CurrentFactMetadata;
}

export interface CurrentBusinessEntity {
  id: string;
  entityTypeId: string;
  entityTypeKey: string;
  name: string;
  status: BusinessEntityStatus;
  source: DataSource;
  externalId: string | null;
  lastVerifiedAt: Date | null;
  updatedAt: Date;
  fields: CurrentBusinessEntityField[];
}

export type CurrentBusinessEntitySearchInput = Omit<
  SearchBusinessEntitiesInput,
  'status' | 'businessId'
>;

export interface CurrentBusinessEntityPage {
  items: CurrentBusinessEntity[];
  limit: number;
  offset: number;
}

export interface BusinessDataProvider {
  getBusinessProfile(): Promise<CurrentBusinessProfile | null>;
  getOpeningHours(): Promise<CurrentOpeningHour[]>;
  getBusinessRules(): Promise<CurrentBusinessRule[]>;
  listEntityTypes(): Promise<CurrentBusinessEntityType[]>;
  searchEntities(
    input: CurrentBusinessEntitySearchInput,
  ): Promise<CurrentBusinessEntityPage>;
  getEntity(
    entityTypeKey: string,
    entityId: string,
  ): Promise<CurrentBusinessEntity | null>;
}
