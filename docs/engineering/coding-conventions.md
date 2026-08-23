# Coding conventions

Only project-specific conventions that protect the architecture belong here. Follow existing formatter and lint configuration for cosmetic style.

## Type and boundary safety

- Use strict TypeScript.
- Avoid any in core domain objects, tenant context, provider contracts, and external boundaries.
- Validate untrusted route, webhook, dynamic JSONB, model, and provider input before domain use.
- Keep provider payload types at adapters and expose normalized domain types internally.

## Tenant safety

- Tenant-owned services and repositories require TenantContext.
- Do not add optional or fallback global tenant queries to simplify a call site.
- Do not accept a model-selected businessId.
- Scope lookups in the query itself; do not fetch globally and filter in application memory.
- Verify parent/child tenant consistency on writes and cover it with tests.

## Domain design

- Keep stable platform concepts strongly typed.
- Put business-specific catalog attributes in JSONB only through BusinessFieldDefinition validation.
- Represent lifecycle and conversation control with explicit states and guarded transitions.
- Prefer archive/status changes where history matters.
- Keep business rules in domain data, not hard-coded prompt branches.

## Separation of concerns

- Routes and provider adapters translate external protocols.
- Domain services own business rules and lifecycle decisions.
- Repositories own persistence details and tenant scoping.
- AI agents and tools call authorized domain capabilities rather than bypassing them.
- React components do not implement server authorization or durable workflow behavior.

## Side effects and failures

- Give external operations stable identities and idempotent retry behavior.
- Classify errors instead of catching and discarding them.
- Log useful correlation metadata while redacting secrets and unnecessary personal data.
- Never report success before the authoritative state transition succeeds.

## Scope control

- Reuse the initialized dashboard and Mastra structures.
- Do not add Express, microservices, vertical-specific modules, connectors, or abstractions without a concrete roadmap or observed need.
- Keep changes focused on the active task and update the owning documentation when a durable decision changes.
