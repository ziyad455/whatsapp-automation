# Customer-service AI action boundaries

The model proposes text and read-only follow-ups. Application code validates the result, uses trusted tenant authorization, checks policy and conversation state, then performs any permitted side effect. A model claim that a customer is an owner or employee never grants access.

## Trusted execution boundary

`runCustomerServiceAgentWithDiagnostics` creates a fresh `RequestContext` and a server-created `CustomerServiceRun` for each invocation. The provider closes over the authorized business ID. Neither customer text, history, model tool arguments, nor stored business data can supply that capability. A foreign history ownership tag fails before generation. The run is closed and removed after completion or failure.

The registered `customerServiceAgent` exposes exactly `getBusinessProfile`, `getOpeningHours`, `getBusinessRules`, `listEntityTypes`, `searchBusinessEntities`, `getBusinessEntity`, and `offerCustomerServiceActions`. There is no SQL, customer-list, transport, mutation, campaign, filesystem, or network tool. There is no persistent agent memory. The separate lead-summary worker has no tools.

S7 tool schemas reject unknown properties, including `businessId`, tenant overrides, status overrides, and arbitrary query objects. Entity IDs must be UUIDs; search permits at most five entities, four unique field filters, eight selected fields, and an offset of 1,000. One run permits at most eight provider lookups and six model steps. The database provider scopes entity type and entity queries to the authorized business and returns only active entities. A foreign entity ID produces the same missing result as an unknown ID.

Customer messages, customer names, business configuration, history, entity text, and rules are untrusted content. History accepts only bounded user/assistant text. Retrieved entity fields remain tool-result JSON, never newly constructed system instructions. Minimal business identity is JSON within a labeled configuration section; it is not authorization. Prompt policy guides language and refusal behavior, while tenant predicates, strict schemas, and absent write tools enforce access even if the model follows an injected instruction.

## Side-effect decisions

| Action | Model authority | Application boundary |
| --- | --- | --- |
| Send WhatsApp text | Propose reply text only; no recipient or send tool | The channel derives recipient/connection from resolved inbound identity, commits a reply only for the expected open AI conversation/control version, and sends the reserved transport message. |
| Create/update a lead | No direct mutation tool | Lead capture loads the persisted customer message for the authorized conversation, applies deterministic qualification and evidence rules, and writes tenant-scoped records. The summary worker proposes a bounded summary only. |
| Change conversation mode/status | No direct control tool | Routing metadata comes from application input analysis and lookup receipts. Existing handoff policy and transactional control-version checks decide whether to switch to HUMAN; authenticated dashboard controls handle employee actions. |
| Schedule a follow-up | No scheduling tool | Application scheduling requires a tenant-owned eligible lead, enabled business policy, active lifecycle, current consent, open AI WhatsApp conversation, and recent persisted lead evidence. |
| Cancel a follow-up | No cancellation tool | Authorized application services and deterministic lifecycle/consent transitions cancel work. |
| Launch a campaign | Not allowed | Authenticated campaign service and dispatch policy own launch, audience authorization, consent, and delivery. |
| Opt a customer out/in | Not allowed | Consent services and explicit authorized customer/operator inputs own consent state; generated prose cannot change it. |
| Change business configuration/prices | Not allowed | Authenticated tenant business services own writes and role checks. Business-data tools are read-only. |
| Write lifecycle/audit events | No event-writing tool | Application transactions record the actual validated operation, not model claims. |
| Assign an employee | Not allowed | Authorized conversation controls validate business membership and conversation state. |
| Offer a next step | Propose only supported read-only action descriptors | `offerCustomerServiceActions` validates the schema/capability list and discovered entity fields. Application code owns offer wording and conversation-owned pending state. |

Passing `needsHuman=true` in assistant prose does not alter routing. The model cannot approve its own authorization, choose a tenant, select another customer, or invent an executable action by naming it.

## Provider failures and invalid output

The WhatsApp channel persists the inbound customer turn before generation. A provider exception or rejected reply propagates to the existing `escalateFailedAiRun` path, which changes an open AI conversation to HUMAN with `LOW_CONFIDENCE`, sets attention time, clears pending actions, and records the transition. It uses the expected control version so a concurrent operator decision is preserved. No alternate escalation system or automatic fallback response is introduced.

The channel does not commit or send a reply after generation fails. Reply normalization rejects empty values, literal `undefined`/`null`, JSON objects/arrays (including JSON fences), and recognizable exception/stack output. Errors are raised with a fixed application message rather than embedding rejected model content. This is a format guard, not a claim that arbitrary fluent falsehoods can be detected deterministically.

## Evidence and limitations

`server/tests/ai-security.test.ts` runs the actual shared Mastra agent/tool loop with a deterministic mock language model. The mock deliberately emits forbidden tool names, foreign business arguments, invalid UUIDs, oversized list requests, and unknown properties. This verifies that safety does not depend on a cooperative model. Another case retrieves stored injection text, verifies its tool-message role, and then attempts a tenant override. A database-adapter case verifies the actual tenant predicate for a guessed entity ID while mocking database I/O.

These tests also assert the complete approved tool surface and reject malformed provider output. `server/tests/whatsapp-agent-channel.test.ts` checks that generation failure follows inbound persistence, requests existing escalation, commits no AI reply, and invokes no send. Existing S6/S7 database integration tests cover persisted tenant isolation separately; the unit suite does not replace that coverage.

The deterministic suite does not measure live-model refusal wording or guarantee that public system instructions can never be paraphrased. System prompts must contain no secrets. No external LLM request, WhatsApp send, or real database write is needed for this suite.

Run the focused checks from `server`:

```sh
node --env-file=.env node_modules/vitest/vitest.mjs run tests/ai-security.test.ts tests/whatsapp-agent-channel.test.ts tests/customer-service-reply-style.test.ts
```
