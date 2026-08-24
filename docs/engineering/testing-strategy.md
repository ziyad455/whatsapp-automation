# Testing strategy

Testing should provide evidence for domain correctness, tenant isolation, AI behavior, provider boundaries, and critical end-to-end journeys.

## Unit tests

Use unit tests for pure validation, state transitions, lead qualification, freshness decisions, quiet hours, frequency limits, normalization, and error classification.

## Integration tests

Use an isolated test database to verify migrations, repositories, transactions, schema-defined JSONB validation, audit behavior, idempotency, and domain services. Tests should be repeatable from a documented command.

The current TypeScript test runner is Vitest. From the repository root, `npm test` validates the test database, applies pending migrations, and runs unit, database, and live Mastra HTTP integration tests.

`TEST_DATABASE_URL` must point to a database distinct from `DATABASE_URL` and its database name must end in `_test`. The runner refuses the configured development database before applying migrations. Explicit ephemeral mode is reserved for isolated temporary PostgreSQL environments used by CI or local verification; it does not relax the development-database equality check.

## Tenant-isolation tests

Create at least two businesses with overlapping-looking identifiers and data. Attempt cross-tenant reads and writes through routes, repositories, nested relationships, tools, filters, conversations, leads, follow-ups, and analytics.

Isolation must fail at deterministic authorization/data layers even when a prompt or direct ID requests another tenant.

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
