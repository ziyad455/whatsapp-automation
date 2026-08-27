import type {
  BusinessEntity,
  BusinessEntityType,
  BusinessFieldDefinition,
  BusinessProfile,
  BusinessRule,
  BusinessSummary,
  BusinessUnderstanding,
  FieldIssue,
  OpeningHour,
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
