# Human handoff

Human handoff is a first-class persisted product capability. It is not merely a prompt request or a hidden dashboard toggle.

## Conversation modes

| Mode | Confirmed behavior |
| --- | --- |
| AI | Supported inbound messages are processed automatically and the AI may reply. |
| HUMAN | Inbound messages are stored, but the AI does not answer. Authorized staff can reply manually. |
| PAUSED | Configured automation behavior is stopped. The exact scope still requires clarification below. |

Mode enforcement belongs on the server. Hiding a UI control or instructing the model is insufficient.

## Escalation

Automatic escalation may occur when:

- the customer explicitly requests a person;
- an important fact is missing, stale, or has low trustworthy support;
- the customer complains;
- strong purchase or booking intent merits staff attention;
- a deterministic business rule requires a person;
- the AI/provider fails and a safe automatic response is unavailable.

The application stores a reason such as CUSTOMER_REQUEST, LOW_CONFIDENCE, PURCHASE_INTENT, COMPLAINT, or MANUAL. The exact enum may evolve, but handoffs must remain explainable.

Model confidence alone is not a reliable safety boundary. Tool outcomes, missing/stale states, explicit intent, and application rules should drive deterministic escalation decisions.

The AI runtime currently returns `AgentResult.needsHuman` and a `reasonCode` only. Application logic—not assistant prose—forces a recognized HUMAN_REQUEST to `needsHuman=true` with CUSTOMER_REQUESTED_HUMAN. Complaints and unresolved missing, unavailable, stale, or unknown tool facts also conservatively request human attention; an ambiguous booking request remains CLARIFICATION_NEEDED. These labels are inputs to future server-side handoff rules, not permissions or proof that a transfer happened. The runtime never changes conversation mode, notifies staff, or promises a connection/callback.

## Takeover

1. The conversation is marked for attention with a reason.
2. An authorized employee switches it to HUMAN.
3. New inbound messages continue to be normalized, deduplicated, persisted, and displayed.
4. No AI reply is sent while HUMAN is active.
5. Staff replies use the same WhatsApp transport and message persistence path.

## Return to AI

Returning control is an explicit authorized action. Before the next automatic reply, the server should use the current conversation state and business data; it must not replay a stale pending AI response.

Human lead classifications and other manual decisions remain authoritative after returning to AI unless deliberately changed.

## Open Questions

- Does PAUSED disable only AI replies, or also follow-ups, campaign messages, escalation workflows, and other automatic side effects?
- How does PAUSED differ operationally from HUMAN for staff replies, assignment, and attention queues?
- The separate Conversation status values and allowed mode/status transitions are not yet defined.
- Whether returning to AI requires a summary, explicit acknowledgement, or cancellation of pending automation has not been specified.
