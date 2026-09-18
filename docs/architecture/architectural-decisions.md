# Architectural decisions

## One shared Mastra server

A single application serves all businesses. This keeps deployment and operations simple while tenant authorization and data access provide isolation. Separate per-business servers would multiply cost and configuration without solving isolation by themselves.

## One shared customer-service agent

Business behavior comes from request-scoped context, rules, and tools rather than hard-coded agents per company. The agent definition is shared; tenant state is not.

The implementation registers one Mastra agent with ID `customer-service`. `runCustomerServiceAgent` builds minimal BusinessContext and instructions per invocation, bounds authorized recent history, creates a fresh RequestContext, and returns strict application-owned AgentResult metadata. Six narrow business-information tools retrieve current facts through the authorized provider; none accepts tenant identity. The shared agent stores no current tenant or persistent memory. Limits, freshness projection, run-local evidence checks, and the distinction between model behavior and server authorization are documented in [AI architecture](../ai/ai-architecture.md) and [agent context](../ai/agent-context.md).

## React + Vite + TypeScript dashboard

The dashboard is a client application for business configuration and operations. Server rendering and Next.js-specific capabilities are not current requirements.

## Better Auth cookie sessions

Better Auth owns platform identity, credential hashing, and server-side sessions in PostgreSQL. Mastra exposes Better Auth through `/auth/api/*`, authenticates protected requests, and places the verified user in request context. The React dashboard uses the Better Auth client with HttpOnly cookies; it does not store or authorize with browser-managed bearer tokens. Public sign-up is disabled while pilot users are provisioned through controlled server-side operations.

Authentication proves identity only. `BusinessUser` membership and role checks authorize access to a `Business`; Better Auth's organization plugin is not part of the application tenancy model.

## Explicit dashboard tenant selection

Tenant-scoped dashboard requests send `x-business-id` as an untrusted selector. After Better Auth establishes identity, the server resolves exactly one `BusinessUser` row through its `(userId, businessId)` unique key and constructs a request-scoped `TenantContext` from database-owned membership data. There is no single-membership fallback, and invalid or unauthorized selections fail closed without business enumeration. Business lifecycle status is intentionally not enforced by the resolver until its action semantics are defined.

## Permanent channel adapters around one AI runtime

Dashboard chat and WhatsApp are independent, permanent entry channels. Each adapter authenticates its own transport and resolves a trusted business scope plus a channel-specific conversation identity before invoking `runCustomerServiceConversation`. The shared boundary owns persisted bounded history, agent invocation, tools, provider, freshness rules, safety behavior, and `AgentResult`; it does not resolve tenants or depend on the originating channel. Dashboard chat identifies its conversation with the verified Better Auth user inside the selected authorized business. WhatsApp uses the verified receiving `phoneNumberId` to resolve the business and the tenant-owned Customer to resolve the conversation.

## Mastra custom routes without Express

Mastra is the backend runtime for HTTP routes, agents, tools, and workflows. A second Express application is postponed until a concrete limitation justifies it.

## PostgreSQL as the initial system of record

PostgreSQL provides relational integrity for tenant/domain data, durable workflow and message state, migrations, transactions, auditability, and JSONB support. External systems may become authoritative for selected facts through providers later.

## Prisma for application persistence

Prisma Client is the application/domain query layer over PostgreSQL, and Prisma Migrate owns application schema history. Routes, tools, and workflows use application services or repositories rather than scattering Prisma queries across transport and AI code.

Prisma does not provide tenant authorization by itself. TenantContext and repository query scoping remain required for future tenant-owned models. Mastra runtime storage is a separate concern even if it later shares the PostgreSQL deployment.

## Explicit tenant-bound repositories

Normal tenant-owned data access uses small repository functions or factories that require the canonical TenantContext. Ownership fields are derived internally, and direct-ID reads and writes add `tenant.businessId` to their Prisma predicates. Raw Prisma remains available only for explicit infrastructure/system needs; Prisma extensions and PostgreSQL row-level security are deferred defense-in-depth options rather than substitutes for auditable application scoping.

BusinessUser resolution is the intentional exception: the authenticated user ID and selected business ID must be queried before TenantContext exists. Once resolved, normal membership access uses the tenant-bound pattern.

## Typed platform data plus schema-defined JSONB

Stable cross-business concepts use typed relational models. Business-specific catalog attributes use JSONB only after validation against BusinessFieldDefinition. This avoids a table/module per vertical without turning the entire domain into unstructured documents.

The implemented persistence shape is one BusinessEntity table for every vertical. BusinessEntityType and BusinessFieldDefinition keep schemas relational; only field options and entity values use JSONB. BusinessFieldDefinition derives ownership from its parent. BusinessEntity keeps direct tenant ownership for normal scoping, and a composite foreign key to BusinessEntityType enforces that both records belong to the same business. This database constraint supplements, rather than replaces, TenantContext-bound repository checks.

New entity values pass through one generic strict validator before persistence. Generic queries validate field filters, build a parameterized JSONB containment predicate, and use a matching `jsonb_path_ops` GIN index plus tenant/type/status relational indexing. Declarative category templates seed the same generic schema records and are never runtime vertical policy. Field keys are immutable; safe changes are transactional and versioned, while destructive in-use option and type changes are rejected until an explicit migration capability exists.

## Request-time current-data retrieval

The agent retrieves volatile facts through tenant-bound tools when needed. Long-lived prompt snapshots, chat history, and model memory are not trusted for prices, availability, or other changing facts.

BusinessDataProvider is the application boundary for those reads. The initial DatabaseBusinessDataProvider is TenantContext-bound and delegates to existing tenant-scoped domain/query services. Connection reuse is desirable; result-snapshot reuse is not. Future authoritative systems can implement the same current-data contract without changing shared AI code or introducing provider federation before it is needed.

## Fact provenance and field-level freshness

Factual profile, opening-hour, rule, and dynamic-entity records carry server-controlled source and verification metadata. Dynamic-field volatility and optional TTL live on BusinessFieldDefinition because one entity may contain stable identity, changing price, and real-time availability. Verification time is independent from value-update time, and no universal TTL is inferred from STABLE, CHANGING, or REAL_TIME.

## Explicit transactional domain audit

AuditEvent is append-only tenant operational data. Auditable services write the domain mutation and a redacted before/after event in one transaction using the actor and business from TenantContext. Explicit service integration preserves action meaning and avoids treating raw Prisma query interception as an authorization-aware domain audit log.

## Human handoff as server-side application state

Conversation control is explicit state (AI, HUMAN, or PAUSED), persisted and enforced by the server. It is not inferred independently on every turn or controlled only by UI visibility.

The application maps AgentResult signals to structured handoff reasons and owns the actual transition; generated prose cannot mutate conversation state. HUMAN means active staff handling and permits manual replies. PAUSED stores inbound messages but suppresses AI and conversation-scoped automation, requires no assignment, and must be taken over before staff can reply. Returning to AI clears assignment, handoff reason, and pending read actions. Mode changes increment a control version, and automated or manual replies use compare-and-set persistence so an earlier control change wins over a stale response.

## Database-backed scheduled automation

Follow-ups and later campaigns use durable database records and recurring workflows rather than in-memory timers. This permits restart recovery, cancellation, inspection, and safe retry handling.

## Evidence-led expansion

The system begins as a modular application with manual/database-backed business data. Microservices, infrastructure complexity, external connectors, advanced RAG, billing automation, and new vertical features are added only after pilot or customer evidence demonstrates the need.
