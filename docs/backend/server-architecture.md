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

The current HTTP foundation initializes a Mastra `RequestContext` for every request with a validated or generated `request-id`. Authentication and tenant resolution will add typed values at trusted boundaries in later sprints; the correlation context is not a substitute for TenantContext.

Application HTTP code lives under `server/src/http/`. Mastra reserves `/api` for built-in routes, so application custom routes use root-level paths such as `/version`. Mastra's built-in `/health` route is process liveness. An exact-path `/ready` middleware checks the centralized PostgreSQL pool without running migrations.

Mastra's Pino logger provides structured request logs with secret-bearing fields redacted. The server-level error handler maps expected application errors to stable status/code/message responses and replaces unexpected errors with a generic response containing the request ID.

## Data and transactions

Persistence should make tenant consistency, lifecycle transitions, idempotency, and audit behavior explicit. External calls cannot share a database transaction; designs must account for retries and ambiguous outcomes rather than assuming atomicity across PostgreSQL and providers.

Application PostgreSQL access uses one centralized `node-postgres` pool wrapped by Drizzle ORM. Drizzle schema definitions live in `server/src/db/schema.ts`, generated SQL migrations live in `server/drizzle/`, and Drizzle Kit owns the migration ledger and apply workflow. This application data layer remains conceptually separate from Mastra runtime storage even when both later use the same PostgreSQL deployment.

## No separate Express layer

Use Mastra custom routes while they satisfy application needs. Add another web framework only for a concrete requirement that cannot be met cleanly, and document the resulting boundary.

## Open Questions

- The authentication mechanism, route schema library, and job-claiming strategy are not fixed by the roadmap.
- Exact module names and folder layout should follow the initialized Mastra project and emerge with implementation.
