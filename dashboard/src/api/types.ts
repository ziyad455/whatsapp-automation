export type BusinessRole = 'OWNER' | 'STAFF'
export type BusinessFieldType =
  | 'TEXT'
  | 'LONG_TEXT'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATETIME'
  | 'SELECT'
  | 'MULTI_SELECT'

export interface BusinessSummary {
  id: string
  name: string
  category: string
  role: BusinessRole
}

export interface BusinessProfile {
  id: string
  name: string
  category: string
  description: string | null
  phone: string | null
  address: string | null
  currency: string
  defaultLanguage: string
  supportedLanguages: string[]
  timezone: string
}

export type BusinessWeekday =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY'

export interface OpeningHour {
  dayOfWeek: BusinessWeekday
  isOpen: boolean
  opensAt: string | null
  closesAt: string | null
}

export interface BusinessRule {
  id: string
  category: string
  name: string
  content: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface BusinessFieldDefinition {
  id: string
  key: string
  label: string
  type: BusinessFieldType
  required: boolean
  enabled: boolean
  options: unknown
  displayOrder: number
}

export interface BusinessEntityType {
  id: string
  key: string
  name: string
  description: string | null
  schemaVersion: number
  fieldCount?: number
  fieldDefinitions?: BusinessFieldDefinition[]
}

export interface BusinessEntity {
  id: string
  entityTypeId: string
  name: string
  data: Record<string, unknown>
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}

export interface FieldIssue {
  field: string | null
  code: string
  message: string
}

export type AgentIntent =
  | 'GENERAL_QUESTION'
  | 'BUSINESS_INFORMATION'
  | 'PRICE_INQUIRY'
  | 'AVAILABILITY_INQUIRY'
  | 'BOOKING_INTENT'
  | 'HUMAN_REQUEST'
  | 'COMPLAINT'
  | 'UNKNOWN'

export type AgentReasonCode =
  | 'NONE'
  | 'CLARIFICATION_NEEDED'
  | 'MISSING_INFORMATION'
  | 'STALE_INFORMATION'
  | 'CUSTOMER_REQUESTED_HUMAN'
  | 'POLICY_REQUIRES_HUMAN'
  | 'UNSUPPORTED_ACTION'

export type AgentLanguage =
  | 'darija-arabic'
  | 'darija-latin'
  | 'ar'
  | 'fr'
  | 'en'
  | 'mixed'
  | 'other'

export interface AgentResult {
  reply: string
  needsHuman: boolean
  detectedIntent: AgentIntent
  reasonCode: AgentReasonCode
  detectedLanguage: AgentLanguage
}

export interface AgentConversationMessage {
  id: string
  role: 'customer' | 'assistant'
  content: string
  createdAt: string
}

export interface AgentConversation {
  id: string
  messages: AgentConversationMessage[]
}

export interface BusinessUnderstanding {
  profile: Omit<BusinessProfile, 'id'> | null
  openingHours: OpeningHour[]
  activeRules: Array<Pick<BusinessRule, 'category' | 'name' | 'content'>>
  entityTypes: Array<{
    key: string
    name: string
    description: string | null
    schemaVersion: number
    fieldDefinitions: Array<Omit<BusinessFieldDefinition, 'id' | 'enabled'>>
    activeEntityCount: number
    representativeEntities: Array<Pick<BusinessEntity, 'name' | 'data'>>
  }>
}
