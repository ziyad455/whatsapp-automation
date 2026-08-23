# Security principles

## Tenant isolation

- Resolve TenantContext before any tenant-owned lookup.
- Require TenantContext in normal tenant services and repositories.
- Never treat an ID supplied by a browser, webhook sender, or model as authorization.
- Bind AI tools to the authorized tenant and exclude businessId from model-controlled inputs.
- Test direct, nested, filtered, and indirect cross-tenant access.

## Authentication and authorization

Authentication identifies the user; BusinessUser membership authorizes tenant access. Sensitive actions also require an appropriate role. UI visibility is not enforcement.

WhatsApp webhook authenticity and phoneNumberId mapping form a separate machine-to-machine tenant-resolution path.

## Validation

Validate at every external boundary:

- dashboard route inputs;
- webhook signatures and payloads;
- dynamic entity values against field definitions;
- model-generated tool arguments and structured results;
- external-provider responses before domain use.

Reject malformed or unsupported input predictably. Do not pass raw provider payloads throughout the application.

## Secrets

Credentials belong in validated environment/secret management, never source, documentation, client bundles, logs, traces, prompts, or tool output. Production secrets need controlled access and rotation.

## Prompt injection

Customer messages and business-provided catalog text are untrusted data. Prompt instructions alone cannot enforce authorization. Deterministic scoping, allow-listed tools, input validation, output limits, and action boundaries must remain effective when the model follows hostile text.

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
