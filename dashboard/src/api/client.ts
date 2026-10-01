import type {
  AgentConversation,
  AgentDiagnostics,
  AgentResult,
  BusinessEntity,
  BusinessEntityType,
  BusinessFieldDefinition,
  BusinessProfile,
  BusinessRule,
  BusinessSummary,
  BusinessUnderstanding,
  ConversationDetail,
  ConversationInboxItem,
  ConversationMessage,
  ConversationMode,
  FieldIssue,
  OpeningHour,
  LeadItem,
  LeadStatus,
  FollowUpSettings,
  CampaignPreview,
  CampaignSummary,
  CustomerHistory,
  CustomerLifecycleEventType,
  CustomerSummary,
  ReactivationSegment,
  AttentionConversation,
  CampaignPerformance,
  ConversationAnalytics,
  DashboardOverview,
  FollowUpQueueFilter,
  FollowUpQueueItem,
  ReportingRange,
} from './types'

const serverUrl = (import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4111').replace(/\/$/, '')

interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
    details?: { fields?: FieldIssue[] }
  }
  requestId?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: FieldIssue[]
  readonly requestId?: string

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? 'The request could not be completed.')
    this.name = 'ApiError'
    this.status = status
    this.code = body.error?.code ?? 'REQUEST_FAILED'
    this.fields = body.error?.details?.fields ?? []
    this.requestId = body.requestId
  }
}

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  businessId?: string
  body?: unknown
}

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { businessId, body, headers, ...requestOptions } = options
  const response = await fetch(`${serverUrl}${path}`, {
    ...requestOptions,
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(businessId === undefined ? {} : { 'x-business-id': businessId }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  if (!response.ok) {
    let errorBody: ApiErrorBody = {}

    try {
      errorBody = (await response.json()) as ApiErrorBody
    } catch {
      // Keep the safe fallback error when the server did not return JSON.
    }

    throw new ApiError(response.status, errorBody)
  }

  return (await response.json()) as T
}

export const dashboardApi = {
  listBusinesses: () => apiRequest<{ businesses: BusinessSummary[] }>('/businesses'),
  getAnalyticsOverview: (businessId: string, range: ReportingRange) =>
    apiRequest<{ overview: DashboardOverview }>(
      `/dashboard/analytics/overview?range=${range}`,
      { businessId },
    ),
  getAttentionQueue: (businessId: string) =>
    apiRequest<{ conversations: AttentionConversation[] }>('/dashboard/analytics/attention', {
      businessId,
    }),
  getFollowUpQueue: (businessId: string, filter: FollowUpQueueFilter) =>
    apiRequest<{ followUps: FollowUpQueueItem[] }>(
      `/dashboard/analytics/follow-ups?filter=${filter}`,
      { businessId },
    ),
  getCampaignPerformance: (businessId: string) =>
    apiRequest<{ campaigns: CampaignPerformance[] }>('/dashboard/analytics/campaigns', {
      businessId,
    }),
  getConversationAnalytics: (businessId: string, range: ReportingRange) =>
    apiRequest<{ analytics: ConversationAnalytics }>(
      `/dashboard/analytics/conversations?range=${range}`,
      { businessId },
    ),
  listConversations: (businessId: string) =>
    apiRequest<{ conversations: ConversationInboxItem[] }>('/dashboard/conversations', {
      businessId,
    }),
  getConversation: (businessId: string, conversationId: string) =>
    apiRequest<{ conversation: ConversationDetail }>(
      `/dashboard/conversations/${conversationId}`,
      { businessId },
    ),
  setConversationMode: (
    businessId: string,
    conversationId: string,
    mode: ConversationMode,
  ) =>
    apiRequest<{ conversation: ConversationDetail }>(
      `/dashboard/conversations/${conversationId}/mode`,
      { method: 'POST', businessId, body: { mode } },
    ),
  sendConversationReply: (
    businessId: string,
    conversationId: string,
    content: string,
  ) =>
    apiRequest<{ message: ConversationMessage }>(
      `/dashboard/conversations/${conversationId}/replies`,
      { method: 'POST', businessId, body: { content } },
    ),
  listLeads: (businessId: string, status?: LeadStatus) =>
    apiRequest<{ leads: LeadItem[] }>(
      `/dashboard/leads${status ? `?status=${encodeURIComponent(status)}` : ''}`,
      { businessId },
    ),
  setLeadStatus: (businessId: string, leadId: string, status: LeadStatus) =>
    apiRequest<{ lead: LeadItem }>(`/dashboard/leads/${leadId}/status`, {
      method: 'POST',
      businessId,
      body: { status },
    }),
  refreshLeadSummary: (businessId: string, leadId: string) =>
    apiRequest<{ lead: LeadItem }>(`/dashboard/leads/${leadId}/summary`, {
      method: 'POST',
      businessId,
    }),
  getFollowUpSettings: (businessId: string) =>
    apiRequest<{ settings: FollowUpSettings }>('/dashboard/follow-up-settings', { businessId }),
  updateFollowUpSettings: (businessId: string, settings: FollowUpSettings) =>
    apiRequest<{ settings: FollowUpSettings }>('/dashboard/follow-up-settings', {
      method: 'PUT', businessId, body: settings,
    }),
  recordFollowUpConsent: (businessId: string, leadId: string, consent: boolean) =>
    apiRequest<{ customer: { id: string; followUpConsentAt: string | null;
      followUpOptedOutAt: string | null } }>(`/dashboard/leads/${leadId}/follow-up-consent`, {
      method: 'POST', businessId, body: { consent, staffAttestation: true },
    }),
  listCustomers: (businessId: string) =>
    apiRequest<{ customers: CustomerSummary[] }>('/dashboard/customers', { businessId }),
  getCustomerHistory: (businessId: string, customerId: string) =>
    apiRequest<{ customer: CustomerHistory }>(
      `/dashboard/customers/${customerId}/history`,
      { businessId },
    ),
  createCustomerLifecycleEvent: (
    businessId: string,
    customerId: string,
    input: { type: CustomerLifecycleEventType; occurredAt: string; metadata?: Record<string, string> },
  ) => apiRequest<{ event: CustomerHistory['lifecycleEvents'][number] }>(
    `/dashboard/customers/${customerId}/lifecycle-events`,
    { method: 'POST', businessId, body: input },
  ),
  recordMarketingPreference: (
    businessId: string,
    customerId: string,
    consent: boolean,
    evidence?: string,
  ) => apiRequest<{ customer: CustomerSummary }>(
    `/dashboard/customers/${customerId}/marketing-preference`,
    {
      method: 'POST',
      businessId,
      body: { consent, staffAttestation: true, ...(evidence ? { evidence } : {}) },
    },
  ),
  listCampaigns: (businessId: string) =>
    apiRequest<{ campaigns: CampaignSummary[] }>('/dashboard/campaigns', { businessId }),
  createCampaign: (businessId: string, input: {
    name: string
    segmentDefinition: ReactivationSegment
    templateName: string
    templateLanguage: string
    templateBody: string
    templateParameters: string[]
  }) => apiRequest<{ campaign: CampaignSummary }>('/dashboard/campaigns', {
    method: 'POST', businessId, body: input,
  }),
  previewCampaign: (businessId: string, campaignId: string) =>
    apiRequest<{ preview: CampaignPreview }>(`/dashboard/campaigns/${campaignId}/preview`, {
      method: 'POST', businessId,
    }),
  prepareCampaign: (businessId: string, campaignId: string) =>
    apiRequest<{ prepare: CampaignPreview }>(`/dashboard/campaigns/${campaignId}/prepare`, {
      method: 'POST', businessId,
    }),
  launchCampaign: (businessId: string, campaignId: string) =>
    apiRequest<{ launch: { campaignId: string; status: 'SENDING'; pending: number } }>(
      `/dashboard/campaigns/${campaignId}/launch`,
      { method: 'POST', businessId },
    ),
  cancelCampaign: (businessId: string, campaignId: string) =>
    apiRequest<{ cancel: { campaignId: string; status: 'CANCELLED' } }>(
      `/dashboard/campaigns/${campaignId}/cancel`,
      { method: 'POST', businessId },
    ),
  getAgentConversation: (businessId: string) =>
    apiRequest<{ conversation: AgentConversation | null }>('/dashboard/agent-chat', {
      businessId,
    }),
  sendAgentMessage: (
    businessId: string,
    message: string,
    conversationId?: string,
  ) =>
    apiRequest<{ conversationId: string; result: AgentResult }>('/dashboard/agent-chat', {
      method: 'POST',
      businessId,
      body: { message, ...(conversationId ? { conversationId } : {}) },
    }),
  getAiPlaygroundConversation: (businessId: string) =>
    apiRequest<{ conversation: AgentConversation | null }>('/dashboard/ai-playground', {
      businessId,
    }),
  sendAiPlaygroundMessage: (
    businessId: string,
    message: string,
    conversationId?: string,
  ) =>
    apiRequest<{ conversationId: string; result: AgentResult; diagnostics: AgentDiagnostics }>(
      '/dashboard/ai-playground',
      {
        method: 'POST',
        businessId,
        body: { message, ...(conversationId ? { conversationId } : {}) },
      },
    ),
  resetAiPlayground: (businessId: string) =>
    apiRequest<{ reset: true }>('/dashboard/ai-playground', {
      method: 'DELETE',
      businessId,
    }),
  getProfile: (businessId: string) =>
    apiRequest<{ profile: BusinessProfile }>('/dashboard/business-profile', { businessId }),
  updateProfile: (businessId: string, profile: Omit<BusinessProfile, 'id' | 'category'>) =>
    apiRequest<{ profile: BusinessProfile }>('/dashboard/business-profile', {
      method: 'PATCH',
      businessId,
      body: profile,
    }),
  getOpeningHours: (businessId: string) =>
    apiRequest<{ hours: OpeningHour[] }>('/dashboard/opening-hours', { businessId }),
  updateOpeningHours: (businessId: string, hours: OpeningHour[]) =>
    apiRequest<{ hours: OpeningHour[] }>('/dashboard/opening-hours', {
      method: 'PUT',
      businessId,
      body: { hours },
    }),
  listRules: (businessId: string) =>
    apiRequest<{ rules: BusinessRule[] }>('/dashboard/business-rules', { businessId }),
  createRule: (
    businessId: string,
    rule: Pick<BusinessRule, 'category' | 'name' | 'content'>,
  ) =>
    apiRequest<{ rule: BusinessRule }>('/dashboard/business-rules', {
      method: 'POST',
      businessId,
      body: rule,
    }),
  updateRule: (
    businessId: string,
    ruleId: string,
    rule: Partial<Pick<BusinessRule, 'category' | 'name' | 'content' | 'active'>>,
  ) =>
    apiRequest<{ rule: BusinessRule }>(`/dashboard/business-rules/${ruleId}`, {
      method: 'PATCH',
      businessId,
      body: rule,
    }),
  listEntityTypes: (businessId: string) =>
    apiRequest<{ entityTypes: BusinessEntityType[] }>('/dashboard/entity-types', {
      businessId,
    }),
  getEntityType: (businessId: string, key: string) =>
    apiRequest<{ entityType: BusinessEntityType }>(`/dashboard/entity-types/${key}`, {
      businessId,
    }),
  createEntityType: (
    businessId: string,
    input: Pick<BusinessEntityType, 'key' | 'name' | 'description'>,
  ) =>
    apiRequest<{ entityType: BusinessEntityType }>('/dashboard/entity-types', {
      method: 'POST',
      businessId,
      body: input,
    }),
  addField: (
    businessId: string,
    entityTypeKey: string,
    input: Omit<BusinessFieldDefinition, 'id'>,
  ) =>
    apiRequest<{ field: BusinessFieldDefinition }>(
      `/dashboard/entity-types/${entityTypeKey}/fields`,
      { method: 'POST', businessId, body: input },
    ),
  updateField: (
    businessId: string,
    entityTypeKey: string,
    fieldId: string,
    input: Partial<Omit<BusinessFieldDefinition, 'id' | 'key'>>,
  ) =>
    apiRequest<{ field: BusinessFieldDefinition }>(
      `/dashboard/entity-types/${entityTypeKey}/fields/${fieldId}`,
      { method: 'PATCH', businessId, body: input },
    ),
  listEntities: (businessId: string, entityTypeKey: string, search = '') => {
    const query = search ? `?search=${encodeURIComponent(search)}` : ''
    return apiRequest<{ items: BusinessEntity[]; limit: number; offset: number }>(
      `/dashboard/entities/${entityTypeKey}${query}`,
      { businessId },
    )
  },
  getEntity: (businessId: string, entityTypeKey: string, entityId: string) =>
    apiRequest<{ entity: BusinessEntity }>(
      `/dashboard/entities/${entityTypeKey}/${entityId}`,
      { businessId },
    ),
  createEntity: (
    businessId: string,
    entityTypeKey: string,
    input: Pick<BusinessEntity, 'name' | 'data'>,
  ) =>
    apiRequest<{ entity: BusinessEntity }>(`/dashboard/entities/${entityTypeKey}`, {
      method: 'POST',
      businessId,
      body: input,
    }),
  updateEntity: (
    businessId: string,
    entityTypeKey: string,
    entityId: string,
    input: Pick<BusinessEntity, 'name' | 'data'>,
  ) =>
    apiRequest<{ entity: BusinessEntity }>(
      `/dashboard/entities/${entityTypeKey}/${entityId}`,
      { method: 'PATCH', businessId, body: input },
    ),
  archiveEntity: (businessId: string, entityTypeKey: string, entityId: string) =>
    apiRequest<{ entity: BusinessEntity }>(
      `/dashboard/entities/${entityTypeKey}/${entityId}/archive`,
      { method: 'POST', businessId },
    ),
  getBusinessUnderstanding: (businessId: string) =>
    apiRequest<{ preview: BusinessUnderstanding }>('/dashboard/business-understanding', {
      businessId,
    }),
}

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'The request could not be completed.'
