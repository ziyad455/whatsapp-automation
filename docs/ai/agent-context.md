# Agent context

Agent context is the bounded information needed for one authorized run. It is not a replica of the business database.

## TenantContext versus BusinessContext

- **TenantContext** proves which business and actor the application has authorized. It is constructed before the agent is invoked.
- **BusinessContext** is the compact business and conversation information made available for that run.

BusinessContext is derived only after TenantContext exists. It cannot change or widen the authorized tenant.

The shared customer-service agent declares a runtime schema for the canonical TenantContext stored under the `tenant` RequestContext key. The invocation boundary validates that object and constructs a new RequestContext per run; missing or malformed trusted context fails before provider execution. Customer messages remain a separate model input and cannot populate or replace this key. A server-created `CustomerServiceRun` capability owns the provider, fact receipts, and lookup outcomes for that invocation. Application-owned result metadata uses those outcomes plus conservative analysis of the current customer input; it never parses the assistant reply. Tracing selects `tenant.businessId` for correlation and hides agent input/output; provider/evidence state uses private fields rather than context snapshots.

`buildBusinessContext` reads the authorized profile through BusinessDataProvider on every invocation. Its model-visible projection contains only business name/category plus timezone, currency, and default/supported languages. Public description/contact details, opening hours, rules, types, and entities are not duplicated in instructions; the appropriate S7 tool retrieves them when needed. This keeps mutable facts request-time and leaves only identity/routing configuration in the prompt.

`buildBusinessInstructions` composes the shared trust/fact/language/uncertainty/output policy with the minimal JSON configuration. Business text cannot override the shared policy. Configuration is rebuilt per call, and the 32,000-character total instruction limit fails explicitly rather than silently truncating configuration.

## Bounded conversation input

The server-only invocation API accepts the current `message` and optional trusted `history` tagged with its business ID. It rejects a tenant mismatch and permits only text `user`/`assistant` messages, never caller-supplied system or tool messages. The shared conversation boundary loads this history from tenant-scoped persistence only after authorizing the conversation's business, channel, and participant identity. A client-supplied conversation ID or ownership tag is not proof of authorization.

Initial agent-history policy: load at most 12 recent persisted messages and then enforce at most 12,000 history characters, plus the current message; every message is limited to 4,000 characters. Keep a contiguous recent suffix and drop a leading orphan assistant answer. These application constants live in `conversation-context.ts` and should be tuned through evaluations. History supports references such as “the first one” but cannot verify an old price. PostgreSQL conversation history is not global Mastra memory; semantic recall and RAG are not introduced.

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

- The initial 12-message history window is bounded but still needs pilot evaluation for long or complex conversations.
- Dashboard conversation persistence is implemented; customer identity, mode/status, assignment, and transport delivery state remain for the later conversation/WhatsApp work.
