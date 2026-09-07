# Server architecture

server/ is the Mastra-based application backend. It owns deterministic domain behavior as well as the AI runtime.

## Responsibilities

- environment validation, startup, health, and database readiness;
- HTTP/custom application routes;
- authentication, session/token validation, membership authorization, and TenantContext;
- input schemas and response boundaries;
- domain services and tenant-scoped repositories;
- PostgreSQL connections, transactions, and migrations;
- dynamic business-schema validation and querying;
- BusinessDataProvider and future external-provider adapters;
- shared agent, context construction, AI tools, and evaluation integration;
- WhatsApp webhook and outbound transport adapters;
- conversations, handoff, leads, and customer history;
- durable Mastra workflows for follow-ups and later campaigns;
- idempotency, retries, logging, tracing, metrics, and operational failures.

## Separation of concerns

A practical request path is:

    route or workflow trigger
      -> authentication/provider verification
      -> tenant resolution
      -> input validation
      -> domain service
      -> repository or external adapter
      -> domain result
      -> transport-safe response

- **Routes/adapters** translate external inputs and outputs.
- **Domain services** enforce lifecycle and business rules.
- **Repositories** perform tenant-scoped persistence without leaking ORM details upward.
- **Providers** isolate Meta, LLM, and future business-data systems.
- **Agents/tools** consume authorized domain capabilities; they do not become an alternative service layer.
- **Workflows** coordinate durable scheduled or retryable operations using persisted state.

Keep these boundaries clear without creating a large speculative directory tree. Introduce modules when implementation needs them.

## Request context

TenantContext is created at trusted entry points and passed through tenant-owned work. Correlation context should connect routes, webhook events, conversations, messages, workflows, tools, and provider calls while limiting sensitive data.

The HTTP foundation initializes a Mastra `RequestContext` for every request with a validated or generated `request-id`. The Mastra Better Auth provider validates HttpOnly session cookies and adds the verified user under the typed `user` context key. As the first operation in a protected dashboard application handler, `resolveDashboardTenantContext` treats `x-business-id` as an untrusted selector, authorizes it with the `(userId, businessId)` membership lookup, and writes the resulting `TenantContext` under the typed `tenant` key. Initialization deletes any client-supplied `tenant` value before resolution. Application code uses fail-closed accessors for both authenticated user and tenant context.

Channel adapters enter `runCustomerServiceConversation` after resolving a trusted TenantContext and authorized conversation identity. That shared application boundary persists the inbound message, loads bounded tenant-scoped history, invokes `runCustomerServiceAgent`, and persists the successful assistant reply. `runCustomerServiceAgent` builds minimal BusinessContext and instructions per run, creates a server-only capability for the tenant-bound provider, accepts the model's plain-text reply, and constructs and validates AgentResult metadata in application code. The registered `customer-service` agent shares one model and six narrow tenant-bound business-information tools, without persistent memory or per-business state. See [agent context](../ai/agent-context.md) for limits and [AI architecture](../ai/ai-architecture.md) for the result contract.

`GET` and `POST /dashboard/agent-chat` form the permanent dashboard channel adapter. They require the verified Better Auth session, resolve `x-business-id` through the existing membership resolver, and resolve one dashboard conversation from the tenant, channel, and authenticated user. A browser-supplied conversation ID is checked against all three values before use. GET returns a bounded transcript; POST invokes the shared conversation runtime and returns its conversation ID plus application-owned AgentResult without tenant or authorization internals. Future WhatsApp handling will use a separate transport, `phoneNumberId` tenant resolver, and customer conversation identity, then call the same conversation runtime.

Application HTTP code lives under `server/src/http/`, while tenant-resolution code lives under `server/src/tenancy/`. Mastra reserves `/api` for built-in routes, so application custom routes use root-level paths such as `/version`, `/businesses`, `/dashboard/*`, and the tenant-context proof route `/tenant-context`. The first-party Better Auth bridge is mounted at `/auth/api/*`; public sign-up is disabled and other application/API routes are protected by default. Mastra's built-in `/health` route is process liveness. An exact-path `/ready` middleware checks PostgreSQL through the centralized Prisma Client without running migrations.

Mastra's Pino logger provides structured request logs with secret-bearing fields redacted. The server-level error handler maps expected application errors to stable status/code/message responses and replaces unexpected errors with a generic response containing the request ID.

## Data and transactions

Persistence should make tenant consistency, lifecycle transitions, idempotency, and audit behavior explicit. External calls cannot share a database transaction; designs must account for retries and ambiguous outcomes rather than assuming atomicity across PostgreSQL and providers.

Application/domain persistence follows this path:

    Mastra route, tool, or workflow
      -> application service or repository
      -> centralized Prisma Client
      -> PostgreSQL

Prisma Client is the application query layer, and Prisma Migrate owns the committed application migration history under `server/prisma/migrations/`. Runtime code must reuse `server/src/db/prisma.ts` rather than constructing clients or connection pools ad hoc. Prisma does not replace authorization: tenant-owned repositories require TenantContext and enforce `businessId` scoping in their queries. The current resolver reuses the membership repository's compound-unique lookup and does not query `Business` separately; business lifecycle enforcement remains an explicit open design question.

Tenant-bound repository and service factories capture `tenant.businessId`; their methods do not accept an ownership selector. Creates build ownership fields from the context, while reads, updates, and deletes include both record ID and business ID in the database operation. `server/src/memberships/tenant-membership.repository.ts` proves this pattern for BusinessUser. Dynamic business data uses a read/schema repository plus dedicated entity, query, and schema-change services under `server/src/business-data/`. The entity service owns validation-before-write, the query service validates filters before parameterized JSONB containment, and the schema service owns transactional field/version changes. The public repository exposes no unvalidated entity create method. OWNER/STAFF action policy remains a calling-service concern.

Conversation persistence follows the same tenant-bound rule. `Conversation` is keyed by business, channel, and channel participant identity. `ConversationMessage` carries direct business ownership, a per-conversation sequence, and a composite foreign key to the same-business conversation. The repository derives business ownership from TenantContext for lookup, append, and bounded history reads; conversation IDs never authorize access by themselves.

Business configuration lives under `server/src/business-configuration/`. Profile, weekly hours, rules, and the assembled understanding preview remain separate domain sources rather than one copied context blob. Dashboard routes validate transport input with Zod, resolve TenantContext first, and delegate business behavior to these services or the generic business-data services. Expected validation failures return stable field/code/message details.

Current business-data consumers bind `DatabaseBusinessDataProvider` to TenantContext. The provider delegates to those existing services and query paths, returns explicit source/freshness metadata, and performs each read against the current database state. Reusing the centralized Prisma client is required; retaining a long-lived profile, rule, price, availability, or catalog snapshot is prohibited.

Meaningful profile, regular-hours, rule, catalog-entity, and safe schema mutations append an AuditEvent in the same interactive Prisma transaction as the change. The audit helper receives the trusted TenantContext actor and business, applies recursive secret-key redaction, and exposes only append and tenant-scoped query operations. Audit logging remains a domain service, not a global Prisma query hook or general request logger.

Raw Prisma access remains available to explicit infrastructure and system/bootstrap repositories. In particular, `BusinessUser` membership lookup during tenant resolution must accept the authenticated user ID and untrusted business selector before TenantContext exists. This boundary exception must not become a general tenant-data access pattern.

Mastra runtime storage remains conceptually separate from application/domain persistence even when both later use the same PostgreSQL deployment.

## No separate Express layer

Use Mastra custom routes while they satisfy application needs. Add another web framework only for a concrete requirement that cannot be met cleanly, and document the resulting boundary.

## Open Questions

- The route schema library and job-claiming strategy are not fixed by the roadmap.
- Exact module names and folder layout should follow the initialized Mastra project and emerge with implementation.
