# Message lifecycle

## Inbound message

    Customer message
      -> Meta webhook
      -> endpoint/signature verification
      -> payload validation and normalization
      -> receiving phoneNumberId resolves business
      -> TenantContext is created
      -> tenant customer is resolved or created
      -> external Meta message ID is atomically claimed
      -> duplicate is acknowledged and stopped
      -> active conversation is resolved or created
      -> inbound Message is persisted
      -> server evaluates AI, HUMAN, or PAUSED behavior

Persist the accepted inbound message before depending on an external LLM or outbound provider. Provider failure must not erase the customer's request.

Inbound claims use `RECEIVED`, `PROCESSING`, `PROCESSED`, and `FAILED` to distinguish durable receipt from successful processing. The claimed transport row is linked to the canonical inbound ConversationMessage. In AI mode it is marked `PROCESSED` only after Meta accepts the tenant-bound reply; HUMAN, PAUSED, and CLOSED conversations are successfully processed once the inbound message is persisted without automation. Conversation, model, or outbound transport failures mark the inbound row `FAILED` and make the webhook return a retryable server error. A failed claim that never reached canonical history may be atomically reclaimed from a later delivery; once linked, duplicate deliveries cannot create a second canonical message, agent run, or reply.

## AI-controlled conversation

    persisted inbound message
      -> bounded conversation context
      -> shared agent
      -> tenant-bound fact tools as needed
      -> structured reply/handoff result
      -> server validates result and current conversation mode
      -> outbound Message is persisted
      -> WhatsApp send service
      -> transport state updates

A generated reply is committed only when the conversation is still OPEN, AI, and at the control version observed before generation. A takeover or pause that commits first suppresses the stale response before transport. The canonical reply and its PENDING WhatsApp transport reservation are created atomically. Mode changes and additional replies return a conflict until that reservation becomes SENT or FAILED, so a control change cannot overtake an in-flight Meta send.

## Human-controlled conversation

In HUMAN mode, inbound messages are persisted and surfaced to staff but do not invoke an automatic AI reply. An authorized dashboard reply follows the normal outbound persistence and transport path and identifies a human sender type.

PAUSED handling follows the same transport and persistence invariants. It stores inbound messages, sends no automatic AI reply, has no required staff assignment, and requires takeover to HUMAN before a manual reply. Later conversation-scoped follow-up/reactivation workers must also reject PAUSED conversations when those workers are introduced.

## Deduplication and idempotency

Inbound external message IDs prevent repeated webhook delivery from creating duplicate messages, agent runs, leads, follow-ups, or replies. Outbound attempts and later scheduled automation also need stable application identities so retries do not duplicate an external side effect.

The duplicate decision must be scoped consistently with provider identity and tenant resolution. Never use deduplication as a substitute for signature validation.

## Status events

Meta delivery, read, and failure events update the matching outbound message without re-running conversation business logic. Updates should be monotonic where provider semantics permit and resilient to repeated or out-of-order events.

## Unsupported or malformed events

Reject unauthentic requests, fail validation predictably, and acknowledge or ignore unsupported authentic events according to provider requirements. Log enough correlation information to diagnose the event without leaking message contents or credentials unnecessarily.

## Open Questions

- The exact internal message-type support beyond text is not yet defined.
- Outbound Meta acceptance and PostgreSQL cannot be one transaction; ambiguous provider-success/local-failure reconciliation still requires a later outbox/retry design.
- The current rule is one durable WhatsApp conversation per business/customer. Product semantics for closing it and creating a later historical conversation remain unspecified.
