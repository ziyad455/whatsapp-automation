# WhatsApp architecture

## Provider boundary

Meta WhatsApp Cloud API is the external transport for inbound messages, outbound messages, and delivery/read/failure status events. During development, a Meta test number and a secure tunnel may expose the local webhook. Production uses configured secure endpoints and production credentials.

Tokens, verify secrets, application secrets, phone identifiers, and temporary tunnel details must never be committed to source or copied into documentation.

## Inbound transport

The Mastra server exposes `GET /webhooks/whatsapp` as an explicitly public route for Meta's subscription challenge. It requires `hub.mode=subscribe`, the server-only `META_WHATSAPP_VERIFY_TOKEN`, and a non-empty `hub.challenge`; a valid request receives the raw challenge and invalid verification receives `403`. The request logger records only the pathname, so the query token is not copied into application logs.

The later inbound-message task will add:

- an event endpoint that validates webhook authenticity;
- normalization from Meta payloads to an internal InboundMessage;
- idempotent processing keyed by external event/message identity.

The normalized message contains only needed transport facts such as external ID, receiving phoneNumberId, sender phone, supported content/type, and timestamp. Domain and AI modules should not depend on the raw Meta payload.

## Tenant resolution

WhatsAppConnection maps Meta phoneNumberId to exactly one business.

    receiving phoneNumberId
      -> trusted WhatsAppConnection lookup
      -> businessId
      -> TenantContext

This happens before customer, conversation, business catalog, or AI data is read. The customer's sender phone is resolved only inside that tenant.

## Outbound transport

A dedicated send-message service translates normalized outbound messages to Meta requests. AI, handoff, lead, and follow-up code use this service rather than embedding provider calls.

Application message state and Meta transport state are related but distinct. Outbound records should reflect pending/sent and later delivered/read/failed outcomes as supported.

## Reliability

- Duplicate webhooks cannot run the AI or send a reply twice.
- Retryable provider failures use bounded retries and idempotency safeguards.
- Permanent failures remain visible for diagnosis or human action.
- Provider status events may arrive more than once or out of order and must not corrupt state.
- Authentication, rate, recipient, template, and transient network failures are classified appropriately.

## Compliance

Templates, consent, outbound eligibility, messaging windows, opt-out, and other requirements must be verified against then-current Meta rules when a sending feature is implemented. Roadmap documentation is not a substitute for current provider policy.
