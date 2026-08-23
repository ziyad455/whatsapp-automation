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
- **listEntityTypes** — expose the dynamic collections available to the tenant.
- **searchBusinessEntities** — search current entities by type, text, and supported safe filters.
- **getBusinessEntity** — retrieve one exact entity after discovery.
- **business-information checker** — state whether a requested fact exists and is sufficiently trustworthy/current.

Tool names are roadmap-level intent; final signatures belong to implementation.

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
