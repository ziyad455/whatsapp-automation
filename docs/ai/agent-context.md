# Agent context

Agent context is the bounded information needed for one authorized run. It is not a replica of the business database.

## TenantContext versus BusinessContext

- **TenantContext** proves which business and actor the application has authorized. It is constructed before the agent is invoked.
- **BusinessContext** is the compact business and conversation information made available for that run.

BusinessContext is derived only after TenantContext exists. It cannot change or widen the authorized tenant.

The shared customer-service agent declares a runtime schema for the canonical TenantContext stored under the `tenant` RequestContext key. The invocation boundary validates that object and constructs a new RequestContext per run; missing or malformed trusted context fails before provider execution. Customer messages remain a separate model input and cannot populate or replace this key. Tracing selects only `tenant.businessId` as tenant correlation metadata rather than attaching user or membership identity.

## Appropriate context

Context may include:

- business identity and description;
- supported languages and response preferences;
- active, relevant business rules;
- opening-hours context when appropriate;
- current conversation mode and handoff state;
- a bounded selection of recent, relevant messages;
- application instructions describing unknown and escalation behavior.

Only include what the current run needs. Avoid unlimited conversation history and complete catalog dumps.

## Facts that should come from tools

Current or potentially volatile facts normally require request-time lookup:

- price;
- availability or stock;
- appointment or booking slots;
- active products, services, vehicles, or memberships;
- current opening hours when they may have changed;
- source, verification, and staleness information.

Stable business identity may be included directly, but a tool can still be preferable when the current value matters.

## Non-authoritative inputs

> LLM memory is not a source of truth.

> The prompt is not a source of truth.

> Conversation history is not a source of truth.

An earlier message may show what was said, not what is currently true. Generated summaries and model labels must remain traceable to domain data or conversation evidence.

## Context construction rules

1. Resolve authorization first.
2. Load only data for the resolved tenant.
3. Separate stable instructions from facts that require tools.
4. Include only active rules and relevant conversation state.
5. Bound history and remove unnecessary sensitive or internal fields.
6. Never interpolate secrets, credentials, hidden system internals, or another tenant's examples.
7. Treat business-supplied and customer-supplied text as data that can contain hostile instructions.

## Open Questions

- The exact history window and relevance strategy should be chosen through evaluation rather than fixed without evidence.
- The roadmap does not yet define which stable business data is embedded per run versus always retrieved through tools.
