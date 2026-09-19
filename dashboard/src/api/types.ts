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
  | 'PURCHASE_INTENT'
  | 'BOOKING_INTENT'
  | 'SUPPORT_REQUEST'
  | 'HUMAN_REQUEST'
  | 'COMPLAINT'
  | 'OUT_OF_SCOPE'
  | 'UNKNOWN'

export type AgentReasonCode =
  | 'NONE'
  | 'CLARIFICATION_NEEDED'
  | 'MISSING_INFORMATION'
  | 'STALE_INFORMATION'
  | 'CUSTOMER_REQUESTED_HUMAN'
  | 'POLICY_REQUIRES_HUMAN'
  | 'UNSUPPORTED_ACTION'
  | 'OUT_OF_SCOPE'

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

export interface AgentToolCallDiagnostic {
  tool:
    | 'getBusinessProfile'
    | 'getOpeningHours'
    | 'getBusinessRules'
    | 'listEntityTypes'
    | 'searchBusinessEntities'
    | 'getBusinessEntity'
  outcome: 'FOUND' | 'MISSING' | 'UNAVAILABLE' | 'INVALID_QUERY'
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN' | null
}

export interface AgentDiagnostics {
  scope: 'BUSINESS_RELATED' | 'OUT_OF_SCOPE'
  generationBypassed: boolean
  partiallyRelated: boolean
  toolCalls: AgentToolCallDiagnostic[]
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

export type ConversationMode = 'AI' | 'HUMAN' | 'PAUSED'
export type ConversationStatus = 'OPEN' | 'CLOSED'
export type ConversationHandoffReason =
  | 'CUSTOMER_REQUEST'
  | 'LOW_CONFIDENCE'
  | 'PURCHASE_INTENT'
  | 'COMPLAINT'
  | 'MANUAL'
export type ConversationSenderType = 'CUSTOMER' | 'AI' | 'HUMAN' | 'SYSTEM'
export type ConversationTransportStatus =
  | 'PENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'

export interface ConversationAssignment {
  membershipId: string
  userId: string
  name: string
  email: string
}

export interface ConversationMessage {
  id: string
  sequence: number
  direction: 'INBOUND' | 'OUTBOUND'
  senderType: ConversationSenderType
  content: string
  createdAt: string
  sentBy: ConversationAssignment | null
  transport: {
    externalMessageId: string | null
    deliveryStatus: ConversationTransportStatus | null
    failureTitle: string | null
  } | null
}

export interface ConversationCustomer {
  id: string
  whatsappPhone: string
}

export interface ConversationInboxItem {
  id: string
  customer: ConversationCustomer
  mode: ConversationMode
  status: ConversationStatus
  handoffReason: ConversationHandoffReason | null
  attentionRequired: boolean
  assignment: ConversationAssignment | null
  lastActivityAt: string
  latestMessage: ConversationMessage | null
}

export interface ConversationDetail extends Omit<ConversationInboxItem, 'latestMessage'> {
  createdAt: string
  messages: ConversationMessage[]
}

export type LeadStatus = 'NEW' | 'INTERESTED' | 'QUALIFIED' | 'WON' | 'LOST'
export type LeadIntent =
  | 'INFORMATION'
  | 'PURCHASE_INTEREST'
  | 'BOOKING_INTEREST'
  | 'COMPLAINT'
  | 'SUPPORT'
export type LeadEvidenceType =
  | 'PURCHASE_INTENT'
  | 'BOOKING_INTENT'
  | 'ITEM_OR_SERVICE'
  | 'DATE_OR_TIME'
  | 'BUDGET'
  | 'QUANTITY_OR_DURATION'
  | 'COMMITMENT'

export interface LeadSummaryDetails {
  summary: string
  keyFacts: Array<{ label: string; value: string }>
  constraints: string[]
  missingImportantInfo: Array<
    'ITEM_OR_SERVICE' | 'DATE_OR_TIME' | 'QUANTITY_OR_DURATION' | 'BUDGET'
  >
}

export interface LeadItem {
  id: string
  status: LeadStatus
  intent: LeadIntent
  statusSource: 'AUTOMATIC' | 'MANUAL'
  summary: string | null
  summaryDetails: LeadSummaryDetails | null
  lastActivityAt: string
  statusUpdatedAt: string
  createdAt: string
  updatedAt: string
  customer: ConversationCustomer
  conversation: {
    id: string
    mode: ConversationMode
    handoffReason: ConversationHandoffReason | null
  }
  evidence: Array<{
    id: string
    evidenceTypes: LeadEvidenceType[]
    createdAt: string
    message: { id: string; content: string; createdAt: string }
  }>
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
