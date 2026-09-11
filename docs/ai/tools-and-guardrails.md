# AI tools and guardrails

## Tool boundary

AI tools are small, validated application capabilities for current business information.

    request
      -> authorized TenantContext
      -> tool bound to that context
      -> tenant-scoped service or BusinessDataProvider
      -> PostgreSQL or authorized provider
      -> limited result for model consumption

> businessId must not be an argument selected by the model.

The model may choose business-domain inputs such as a search term, entity type key, or safe filter. It cannot choose or override the tenant.

## Initial read tools

- **getBusinessProfile** — return the current tenant's stable public profile.
- **getOpeningHours** — return current opening hours.
- **getBusinessRules** — return active rules relevant to the decision.
- **listEntityTypes** — expose the tenant's dynamic collections and their enabled, non-sensitive field keys.
- **searchBusinessEntities** — search current entities by type, text, and supported safe filters.
- **getBusinessEntity** — retrieve one exact entity after discovery.
- **business-information checker** — state whether a requested fact exists and is sufficiently trustworthy/current.

The six implemented read tools are registered once on both the shared agent and Mastra. `getBusinessProfile`, `getOpeningHours`, `getBusinessRules`, and `listEntityTypes` accept only an empty strict object. `searchBusinessEntities` accepts an entity-type key, optional bounded text, up to four unique simple field/value filters, up to eight projected field keys, a maximum limit of five, and bounded offset. `getBusinessEntity` accepts an entity-type key, an entity ID returned by discovery, and up to twenty projected fields. No input accepts tenant, membership, user, lifecycle-status, Prisma, SQL, JSON-path, or arbitrary query selectors.

Every execution requires the validated TenantContext and the server-created `CustomerServiceRun` capability. The capability supplies one provider already bound to that tenant; changing tool arguments cannot replace it. Exact entity lookup scopes the ID and type within that provider, so a foreign ID and nonexistent ID both return MISSING without revealing ownership.

All outputs use Zod-validated model projections. Profile, hours, active rules, and type lists are small and purpose-specific. Type discovery returns at most twenty types and twenty enabled, non-sensitive field definitions per type so the model can discover tenant-specific facts without guessing field keys. Search returns at most five active entities, eight fields per result, and approximately 16,000 projected characters; exact lookup returns at most twenty fields; rules are capped at twenty. Outputs omit business/ownership IDs, internal foreign keys, integration IDs, schema/audit internals, irrelevant timestamps, and secret-like dynamic fields. Only the entity ID required for follow-up exact lookup remains visible.

The shared business-information checker combines explicit FOUND, MISSING, UNAVAILABLE, or INVALID_QUERY state with the existing provider-calculated FRESH, STALE, or UNKNOWN status. It does not recalculate staleness. STALE/UNKNOWN values are withheld as null, disabled rules are filtered by the domain service before projection, and infrastructure failure is distinct from an empty result. `CustomerServiceRun` records these trusted outcomes for application-owned AgentResult normalization.

## Input guardrails

- Validate all model-generated input against explicit schemas.
- Allow only supported filters and bounded pagination.
- Resolve entity IDs inside TenantContext; never perform a global lookup and filter afterward.
- Treat customer text, business catalog text, and tool results as untrusted content, not instructions.
- Separate read tools from any future side-effecting capability.

## Output guardrails

- Return only fields needed for the answer.
- Cap rows and text length.
- Remove internal IDs, audit internals, secrets, and unrelated personal data.
- Include explicit missing, stale, or unavailable states.
- Preserve enough source/freshness information for safe response decisions.
- Do not return raw database rows or unrestricted JSONB by default.

## Unknown and hallucination behavior

When a fact is absent or untrustworthy, the tool reports that state. The agent must not fill the gap from general knowledge, another tenant, an earlier conversation, or a plausible guess. It may ask a clarifying question or set needsHuman according to the situation.

## Prompt-injection resistance

Prompt wording is not the security boundary. Tests should attempt to:

- request another business by name or ID;
- override system or business rules;
- expose hidden instructions or internal metadata;
- misuse tool filters or arbitrary identifiers;
- turn catalog content into instructions.

Authorization, validation, scoping, and output projection must block these attempts even if the model follows the hostile instruction.

## Side-effect boundary

The initial business-information tools are reads. Any later action that sends a message, changes state, books something, or starts a campaign requires deterministic server authorization and validation. A model suggestion is not permission to perform an external action.

## Capability offers and pending actions

The application derives offerable follow-up capabilities from the enabled read-tool set. The model cannot create pending state through prose: it may request that the bounded `offerCustomerServiceActions` control tool register up to two supported read-only actions, and the application validates and renders the customer-facing offer. Listing entities is accepted only after the run has established the tenant's entity type through a real lookup. A dynamic-field check is accepted only after `listEntityTypes` has exposed that exact enabled field for the current tenant; the trusted schema label, not model prose, is persisted with the action.

Validated offers are stored as bounded JSON on the tenant-owned conversation. A short acceptance such as “okay do that” consumes one unambiguous pending action through the same shared agent and read tools. Two pending actions produce an application-owned clarification instead of a guess. Model-authored capability claims and system/database narration are removed at the final application boundary. Side-effecting booking/reservation creation, delivery arrangement, payment, discount/refund, callbacks, and automatic staff contact remain unsupported. Read-only facts such as weekly rates, insurance terms, or delivery rules are tenant-specific: the agent may answer only when the current tenant's schema or active rules expose fresh supporting data.
