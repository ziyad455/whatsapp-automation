# Testing strategy

Testing should provide evidence for domain correctness, tenant isolation, AI behavior, provider boundaries, and critical end-to-end journeys.

## Unit tests

Use unit tests for pure validation, state transitions, lead qualification, freshness decisions, quiet hours, frequency limits, normalization, and error classification.

## Integration tests

Use an isolated test database to verify migrations, repositories, transactions, schema-defined JSONB validation, audit behavior, idempotency, and domain services. Tests should be repeatable from a documented command.

The current TypeScript test runner is Vitest. From the repository root, `npm test` validates the test database, applies committed Prisma migrations with `prisma migrate deploy`, and runs unit, database, and live Mastra HTTP integration tests.

`TEST_DATABASE_URL` must point to a database distinct from `DATABASE_URL` and its database name must end in `_test`. The runner refuses the configured development database before applying migrations. Explicit ephemeral mode is reserved for isolated temporary PostgreSQL environments used by CI or local verification; it does not relax the development-database equality check.

Schema changes use `prisma migrate dev` to create migrations in development. Clean or deployed environments use `prisma migrate deploy`; schema-push commands are not a replacement for committed migration history.

Current persistence coverage includes Better Auth identity/credential storage and `BusinessUser` role, uniqueness, multi-business, multi-user, foreign-key, and cascade behavior. HTTP integration coverage exercises disabled public sign-up, valid and invalid credentials, cookie/CORS attributes, session lookup, protected request context, logout, and invalid or expired sessions.

Tenant data-access coverage binds repositories to independent TenantContext fixtures and verifies own-tenant reads, cross-tenant read denial, context-owned creates, and ID-plus-business scoping for updates and deletes. Dynamic-data unit and integration coverage uses car-dealer, salon, and gym tenants to prove strict validation-before-write, one JSONB entity table, generic validated queries, idempotent customizable templates, atomic schema versions, preservation under safe edits, rejection of destructive edits, useful relational/GIN indexes, and cross-tenant denial at service and database boundaries.

Sprint 4 integration coverage additionally exercises profile changes, the seven-day local-time schedule and invalid-range rejection, BusinessRule lifecycle, generic dashboard routes, dynamic record create/update/archive behavior, disabled historical-value preservation, tenant-local field customization across car-rental/salon/gym fixtures, and deterministic preview assembly. The dashboard currently has no frontend test runner; until one is introduced for a concrete UI need, strict TypeScript plus manual browser scenarios provide frontend evidence without creating an ad hoc second test architecture.

Sprint 5 coverage exercises server-controlled provenance, secret-safe transactional before/after audit events, tenant-scoped audit reads, field-level STABLE/CHANGING/REAL_TIME classifications, deterministic FRESH/STALE/UNKNOWN decisions, verification without value mutation, archive/restore history, and one DatabaseBusinessDataProvider across car-rental, salon, and gym tenants. Request-time tests reuse the same provider instance and prove that price and availability updates appear on the next call without a cached snapshot.

Sprint 6 shared-agent coverage verifies one stable registration, no tenant-specific prompt or persistent memory, validated request-scoped TenantContext propagation, A-to-B-to-A reuse, concurrent car-rental/salon/gym isolation, forged-message resistance, and failure before model execution when trusted context is absent. These tests use an injected executor seam at the production invocation boundary and do not call the external LLM provider.

## Tenant-isolation tests

Create at least two businesses with overlapping-looking identifiers and data. Attempt cross-tenant reads and writes through routes, repositories, nested relationships, tools, filters, conversations, leads, follow-ups, and analytics.

Isolation must fail at deterministic authorization/data layers even when a prompt or direct ID requests another tenant.

Each tenant-owned model's implementation is incomplete until its tests prove:

- both tenants can read their own records;
- exact foreign IDs do not bypass ownership checks in either direction;
- lists contain only the bound tenant's records;
- foreign updates and deletes fail without changing the target;
- create/update ownership cannot be redirected with caller-supplied `businessId`;
- applicable HTTP selectors, forged context values, and concurrent requests cannot replace trusted TenantContext state.

Small helpers under `server/tests/helpers/` may standardize denial and no-side-effect assertions. Future Customer, Conversation, Message, Lead, and FollowUp tests extend this pattern only when those models are implemented.

## AI evaluations

Maintain repeatable cases for:

- Darija, Arabic, French, English, and mixed language;
- price, availability, hours, and business rules;
- deliberately absent or stale facts;
- complaints, purchase/booking intent, and handoff;
- multi-turn context;
- prompt injection and tenant escape;
- regression after model, prompt, tool, or schema changes.

Use the car-rental, salon, and gym fixtures to prove one shared agent supports different schemas without code branches.

## WhatsApp integration tests

Test signature validation, webhook verification, event normalization, number-to-business mapping, duplicate delivery, outbound mapping, status events, and provider failure classification with controlled fixtures/fakes before relying on live Meta testing.

## Workflow tests

Test scheduling, cancellation after customer reply, final eligibility, quiet hours, frequency caps, concurrent claiming, transient retry, permanent failure, and restart-safe persistence.

## End-to-end tests

Critical production journeys cover:

    WhatsApp -> Meta webhook -> tenant resolution -> conversation
      -> shared agent -> current-data tool -> response -> Meta

Also cover human takeover/return, lead creation, follow-up cancellation/sending, cross-tenant attempts, provider failure, and clean-environment configuration.

## Test evidence

Do not claim a build, test, provider exchange, browser behavior, or recovery procedure passed unless it actually ran. Restoration is proven only by restoring a backup into a safe environment.
