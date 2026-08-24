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

The current HTTP foundation initializes a Mastra `RequestContext` for every request with a validated or generated `request-id`. The Mastra Better Auth provider validates HttpOnly session cookies and adds the verified user under the typed `user` context key. Application routes call a fail-closed accessor rather than reading untrusted headers or cookies directly. Tenant resolution will add `TenantContext` in its owning sprint; neither the authenticated user nor correlation context is a substitute for it.

Application HTTP code lives under `server/src/http/`. Mastra reserves `/api` for built-in routes, so application custom routes use root-level paths such as `/version` and `/account`. The first-party Better Auth bridge is mounted at `/auth/api/*`; public sign-up is disabled and other application/API routes are protected by default. Mastra's built-in `/health` route is process liveness. An exact-path `/ready` middleware checks PostgreSQL through the centralized Prisma Client without running migrations.

Mastra's Pino logger provides structured request logs with secret-bearing fields redacted. The server-level error handler maps expected application errors to stable status/code/message responses and replaces unexpected errors with a generic response containing the request ID.

## Data and transactions

Persistence should make tenant consistency, lifecycle transitions, idempotency, and audit behavior explicit. External calls cannot share a database transaction; designs must account for retries and ambiguous outcomes rather than assuming atomicity across PostgreSQL and providers.

Application/domain persistence follows this path:

    Mastra route, tool, or workflow
      -> application service or repository
      -> centralized Prisma Client
      -> PostgreSQL

Prisma Client is the application query layer, and Prisma Migrate owns the committed application migration history under `server/prisma/migrations/`. Runtime code must reuse `server/src/db/prisma.ts` rather than constructing clients or connection pools ad hoc. Prisma does not replace authorization: future tenant-owned repositories still require TenantContext and enforce `businessId` scoping in their queries.

Mastra runtime storage remains conceptually separate from application/domain persistence even when both later use the same PostgreSQL deployment.

## No separate Express layer

Use Mastra custom routes while they satisfy application needs. Add another web framework only for a concrete requirement that cannot be met cleanly, and document the resulting boundary.

## Open Questions

- The route schema library and job-claiming strategy are not fixed by the roadmap.
- Exact module names and folder layout should follow the initialized Mastra project and emerge with implementation.
