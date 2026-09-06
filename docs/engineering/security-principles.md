# Security principles

## Tenant isolation

- Resolve TenantContext before any tenant-owned lookup.
- Require TenantContext in normal tenant services and repositories.
- Never treat an ID supplied by a browser, webhook sender, or model as authorization.
- Bind AI tools to the authorized tenant and exclude businessId from model-controlled inputs.
- Test direct, nested, filtered, and indirect cross-tenant access.

Tenant-owned repository APIs bind a trusted TenantContext and do not accept raw business ownership fields. Reads, updates, and deletes scope by record ID plus `tenant.businessId`; creates set business ownership from the context and ignore caller-controlled ownership. Raw Prisma access is reserved for explicit infrastructure/system boundaries, including the BusinessUser lookup required to construct TenantContext.

Cross-tenant regression tests are a mandatory security gate for every tenant-owned resource. A denial assertion must also prove that the foreign record was not returned, changed, deleted, or created through ownership spoofing.

## Authentication and authorization

Authentication identifies the user; BusinessUser membership authorizes tenant access. Sensitive actions also require an appropriate role. UI visibility is not enforcement.

Dashboard authentication uses Better Auth server-side sessions and HttpOnly, host-only cookies. The server accepts credential/session requests only from the configured dashboard origin, enables credentialed CORS for that exact origin, and requires HTTPS origins except for loopback development. Public sign-up is disabled. React never reads the session token, and protected UI routes do not replace server-side authentication or membership checks.

For tenant-scoped dashboard APIs, `x-business-id` is an untrusted selection hint. The server combines it only with the user ID established by Better Auth and authorizes the compound `BusinessUser` membership before business work begins. It ignores client-supplied user IDs, membership IDs, roles, and tenant request-context values. Cross-tenant, unknown, and malformed selectors receive the same non-enumerating forbidden response.

WhatsApp webhook authenticity and phoneNumberId mapping form a separate machine-to-machine tenant-resolution path.

## Validation

Validate at every external boundary:

- dashboard route inputs;
- webhook signatures and payloads;
- dynamic entity values against field definitions;
- model-generated tool arguments and application-owned AgentResult output;
- external-provider responses before domain use.

Reject malformed or unsupported input predictably. Do not pass raw provider payloads throughout the application.

Dynamic entity validation is centralized and strict: it rejects coercion, unknown or disabled fields, missing required values, invalid canonical dates/datetimes, and values outside select definitions before persistence. Query filters pass through the same field-type rules. The generic query builds a parameterized JSONB containment value rather than interpolating field names, values, or arbitrary JSON paths into SQL.

Opening-hours input must include each weekday once and pass both service validation and a database check that closed days have no times and open days close later than they open. BusinessRule, field, and entity identifiers are always combined with resolved tenant ownership before mutation. Schema safety failures are returned as structured validation errors rather than bypassed by the dashboard.

## Secrets

Credentials belong in validated environment/secret management, never source, documentation, client bundles, logs, traces, prompts, or tool output. Production secrets need controlled access and rotation.

Domain audit snapshots pass through recursive secret-key redaction before persistence. Audit services derive business and dashboard actor from TenantContext, expose no normal update/delete operation, and scope history reads by the bound business. Browser payloads cannot choose a factual record's source or external-provider identity.

## Prompt injection

Customer messages and business-provided catalog text are untrusted data. Prompt instructions alone cannot enforce authorization. Deterministic scoping, allow-listed tools, input validation, output limits, and action boundaries must remain effective when the model follows hostile text.

Agent invocation keeps trusted TenantContext in Mastra RequestContext and messages in a separate input channel. The runtime schema requires valid internal identifiers and role before provider execution. The shared prompt contains no tenant identifiers, and neither customer text nor client-provided request-context data may become the authorized tenant.

Business instruction JSON is rebuilt from tenant-scoped services and remains untrusted text with respect to the shared safety policy. Tools require a server-created run capability in addition to the typed tenant shape; a plausible JSON object or prompt cannot construct it. History accepts only bounded user/assistant text from the authorized application caller. Strict tool schemas contain no tenant selector, outputs are bounded projections, and missing/stale tool outcomes drive application-owned safe metadata and reply substitution. These checks enforce the runtime contract, not perfect semantic truth; prompt-injection and provider-language evaluations remain required.

## AI action boundaries

The model may propose a reply, intent, or handoff. It does not grant permissions. Any external side effect requires current server-side authorization, validation, lifecycle checks, and idempotency.

## Webhook and automation safety

- Verify signatures before processing protected webhook data.
- Deduplicate provider retries.
- Rate-limit public or sensitive paths without breaking valid provider behavior.
- Recheck current eligibility immediately before delayed sends.
- Redact personal data and secrets from logs while retaining useful correlation.

## Recovery and privacy

Backups must be monitored and restoration tested. Retention, customer/business data handling, and third-party AI processing must be defined before broad production use and sufficiently addressed before real pilot data is processed.

## Open Questions

- Pilot-specific privacy, retention, and AI-provider disclosures are not yet specified even though the full policy is scheduled for production work.
- Platform-admin authentication and audited cross-tenant access are not yet defined.
