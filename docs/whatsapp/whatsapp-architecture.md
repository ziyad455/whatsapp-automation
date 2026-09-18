# WhatsApp architecture

## Provider boundary

Meta WhatsApp Cloud API is the external transport for inbound messages, outbound messages, and delivery/read/failure status events. During development, a Meta test number and a secure tunnel may expose the local webhook. Production uses configured secure endpoints and production credentials.

Tokens, verify secrets, application secrets, phone identifiers, and temporary tunnel details must never be committed to source or copied into documentation.

## Inbound transport

The Mastra server exposes `GET /webhooks/whatsapp` as an explicitly public route for Meta's subscription challenge. It requires `hub.mode=subscribe`, the server-only `META_WHATSAPP_VERIFY_TOKEN`, and a non-empty `hub.challenge`; a valid request receives the raw challenge and invalid verification receives `403`. The request logger records only the pathname, so the query token is not copied into application logs.

`POST /webhooks/whatsapp` is the explicitly public inbound event boundary. It
reads the original request bytes, verifies `X-Hub-Signature-256` with the
server-only Meta app secret, and only then parses JSON. Missing, malformed, or
incorrect signatures receive `401` before payload validation or database work.

Authenticated payloads are validated and normalized into the application-owned
`InboundMessage` type. The current MVP accepts text messages, preserves Meta's
message ID and provider timestamp, and safely ignores status-only events and
unsupported message types. Raw Meta nesting does not leave this adapter.

The normalized message contains only needed transport facts such as external ID, receiving phoneNumberId, sender phone, supported content/type, and timestamp. Domain and AI modules should not depend on the raw Meta payload.

## Tenant resolution

WhatsAppConnection maps Meta phoneNumberId to exactly one business. The database
enforces global phoneNumberId uniqueness while allowing one business to own
multiple active or inactive connections.

    receiving phoneNumberId
      -> trusted WhatsAppConnection lookup
      -> businessId
      -> TenantContext

This happens before customer, conversation, business catalog, or AI data is read. The customer's sender phone is resolved only inside that tenant.

An authentic event for an unmapped number is acknowledged with `200` and logged
using safe provider/application identifiers. This avoids a provider retry storm
for an internal configuration issue; it never falls back to another business.
For a mapped number, the endpoint resolves or creates a Customer by the compound
`(businessId, whatsappPhone)` identity. The numeric `messages[].from` value is
preserved unchanged; it never selects a tenant and is not globally unique.
Customer creation is atomic and database-constrained for concurrent deliveries.
It then atomically claims the globally unique Meta message ID in the WhatsApp
transport ledger. Only the first claim is eligible for downstream processing;
duplicates receive `200` but cannot trigger another agent run or reply. The
claim moves through `PROCESSING` while the customer message enters the
tenant-bound persistent `WHATSAPP` conversation. The canonical inbound message
is linked to that claim before mode evaluation. OPEN/AI conversations invoke
the shared customer-service runtime; HUMAN and PAUSED conversations store the
message without an automatic reply. AI processing is marked `PROCESSED` after
Meta accepts the reply, while non-automated modes are processed after durable
storage. Failures are marked `FAILED` and visible HUMAN attention is applied
when an AI/provider failure can no longer produce a safe reply.

Development mappings are provisioned explicitly with the server's
`whatsapp:connect` script and a selected business ID; webhook handling never
creates or reassigns a connection implicitly.

## API versions

The Graph API version configured for future outbound requests is independent
from the webhook subscription version selected in Meta. Inbound normalization
depends on the stable message payload fields it validates rather than a
hard-coded Graph API version. This work therefore does not change the existing
outbound `META_WHATSAPP_API_VERSION` setting.

## Outbound transport

A dedicated send-message service resolves the active connection using both the trusted business and connection IDs, then delegates to the Meta transport. The transport alone owns the configured Graph API version, `/{phoneNumberId}/messages` URL, bearer credential, text payload, ten-second timeout, and provider response parsing. AI, handoff, lead, and follow-up code use this service rather than embedding provider calls. A successful provider response becomes the application-owned `{ provider, accepted, externalMessageId }` result.

Development currently uses one server-side access token, while the sender `phoneNumberId` always comes from the resolved `WhatsAppConnection`. This keeps credentials out of domain and AI code and leaves a narrow transport boundary for later encrypted per-connection credentials.

Provider failures are application-owned errors: invalid requests, authentication, rate limiting, provider unavailability, network failure, timeout, invalid response, configuration, and unavailable connection. Rate limits, provider 5xx responses, network failures, and timeouts are classified as retryable signals, but this service performs no automatic retry. Until an outbox/idempotency design exists, callers must reconcile ambiguous outcomes before retrying to avoid duplicate customer-visible messages.

## Delivery status webhooks

Signed `statuses[]` events are normalized into an application-owned event with
external message ID, receiving phone-number ID, recipient, status, provider
timestamp, and bounded safe failure fields. They never become `InboundMessage`
objects and never enter customer or AI processing. Meta may deliver `sent`,
`delivered`, `read`, and `failed` notifications repeatedly or out of arrival
order, so status updates use explicit precedence and conditional writes.

An event can mutate only the outbound row matching the trusted business and
connection resolved from `phoneNumberId`, the external Meta ID, and recipient.
Unknown or cross-tenant IDs are acknowledged and logged without mutation. API
acceptance means `SENT`, not delivered or read. A delayed lower status never
regresses a higher state; it may only backfill its missing milestone timestamp.

Application message state and Meta transport state are related but distinct. A canonical ConversationMessage holds customer-visible content and sender identity; its linked WhatsAppMessage holds pending/sent and later delivered/read/failed provider outcomes. A failed transport attempt therefore remains visible in the shared history without being presented as delivered.

## Reliability

- Duplicate webhooks cannot run the AI or send a reply twice.
- Retryable provider failures use bounded retries and idempotency safeguards.
- Permanent failures remain visible for diagnosis or human action.
- Provider status events may arrive more than once or out of order and must not corrupt state.
- Authentication, rate, recipient, template, and transient network failures are classified appropriately.

## Compliance

Templates, consent, outbound eligibility, messaging windows, opt-out, and other requirements must be verified against then-current Meta rules when a sending feature is implemented. Roadmap documentation is not a substitute for current provider policy.
