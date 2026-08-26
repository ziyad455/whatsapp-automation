# Data ownership

Ownership determines where a concept belongs, how it is validated, and which component may treat it as authoritative.

## Platform and domain data

These concepts have stable meaning across businesses and should use strongly typed relational models:

- business, user, and membership;
- customer, conversation, and message;
- WhatsApp connection and delivery state;
- lead and follow-up;
- customer lifecycle event and campaign;
- roles, statuses, audit records, and operational identities.

Tenant-owned domain records are scoped by businessId even when they also reference a tenant-owned parent.

Normal application repositories receive a trusted TenantContext and derive `businessId` internally. Ownership is not part of create/update DTOs, and record-ID reads or writes include the tenant business ID in the database predicate. Global access is reserved for explicit infrastructure, provisioning, maintenance, and tenant-resolution boundaries.

`BusinessUser` illustrates both sides of this boundary: the membership lookup used to create TenantContext legitimately runs before context exists, while normal post-resolution membership data access is tenant-bound.

## Business-specific configuration and catalog

Business profile, hours, policies, entity types, field definitions, and entities describe what is unique to a business. Business-specific catalog attributes use validated JSONB, while their ownership, schema, status, and timestamps remain relational.

BusinessEntityType and BusinessEntity carry direct tenant ownership. BusinessFieldDefinition has no redundant `businessId`; it is owned through BusinessEntityType. The database requires each BusinessEntity's direct business ownership and referenced entity type to agree. The tenant entity service validates new JSON against enabled field definitions before the only normal write path persists it. Disabled historical values remain PostgreSQL-owned business data and are not silently removed or reinterpreted.

The dashboard is a management interface for this data, not the data source itself.

## AI operational data

Agent runs, tool calls, structured intent/handoff output, evaluation cases/results, token usage, and AI errors support decision-making, testing, and operations. They must not become authoritative copies of prices, availability, customer state, or business policies.

Model-generated labels are suggestions or structured inputs to application rules. They do not grant authorization and do not override staff decisions.

## External systems

Meta owns WhatsApp transport identities, webhook events, message delivery status, templates, and provider-side eligibility. Future booking, POS, commerce, or CRM systems may own selected business facts.

The local system stores the identifiers, normalized state, audit information, and synchronization metadata required to operate reliably. BusinessDataProvider isolates domain and AI code from provider details.

## Source-of-truth rules

- PostgreSQL is initially authoritative for dashboard-managed data.
- An explicitly configured provider may be authoritative for a specific fact.
- The LLM, prompt, generated summary, and conversation history are never authoritative business databases.
- Transport payloads are validated and normalized before becoming application input.
- Analytics derives from domain and operational records; it does not redefine them.

## Decision guide

When adding a concept, ask:

1. Does every supported business use the same meaning and lifecycle? Prefer a typed domain model.
2. Is it a configurable catalog attribute that varies by business? Prefer a field definition plus validated JSONB.
3. Is it only evidence about AI or system execution? Keep it operational and non-authoritative.
4. Does another system own the current value? Access it through a provider and record source/freshness.
5. Is it tenant-owned? Require TenantContext and business-scoped persistence.
