# Message lifecycle

## Inbound message

    Customer message
      -> Meta webhook
      -> endpoint/signature verification
      -> payload validation and normalization
      -> duplicate check
      -> receiving phoneNumberId resolves business
      -> TenantContext is created
      -> tenant customer is resolved or created
      -> active conversation is resolved or created
      -> inbound Message is persisted
      -> server evaluates AI, HUMAN, or PAUSED behavior

Persist the accepted inbound message before depending on an external LLM or outbound provider. Provider failure must not erase the customer's request.

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

A mode change or customer activity that occurs during processing must not allow a stale automated reply to bypass current state.

## Human-controlled conversation

In HUMAN mode, inbound messages are persisted and surfaced to staff but do not invoke an automatic AI reply. An authorized dashboard reply follows the normal outbound persistence and transport path and identifies a human sender type.

PAUSED handling follows the same transport and persistence invariants, but the exact set of disabled automations remains an [open handoff question](../ai/human-handoff.md#open-questions).

## Deduplication and idempotency

Inbound external message IDs prevent repeated webhook delivery from creating duplicate messages, agent runs, leads, follow-ups, or replies. Outbound attempts and later scheduled automation also need stable application identities so retries do not duplicate an external side effect.

The duplicate decision must be scoped consistently with provider identity and tenant resolution. Never use deduplication as a substitute for signature validation.

## Status events

Meta delivery, read, and failure events update the matching outbound message without re-running conversation business logic. Updates should be monotonic where provider semantics permit and resilient to repeated or out-of-order events.

## Unsupported or malformed events

Reject unauthentic requests, fail validation predictably, and acknowledge or ignore unsupported authentic events according to provider requirements. Log enough correlation information to diagnose the event without leaking message contents or credentials unnecessarily.

## Open Questions

- The exact internal message-type support beyond text is not yet defined.
- Transaction boundaries between persistence, AI execution, and outbound sending need an explicit idempotent processing design.
- Conversation creation/reuse rules, such as when an old conversation is closed and a new one begins, are not yet specified.
