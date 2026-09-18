# Human handoff

Human handoff is a first-class persisted product capability. It is not merely a prompt request or a hidden dashboard toggle.

## Conversation modes

| Mode | Confirmed behavior |
| --- | --- |
| AI | Supported inbound messages are processed automatically and the AI may reply. |
| HUMAN | Inbound messages are stored, but the AI does not answer. Authorized staff can reply manually. |
| PAUSED | Inbound messages are stored, but AI replies and conversation-scoped automatic follow-up/reactivation work are suppressed. It does not imply assignment or active staff handling, and manual replies require an explicit takeover to HUMAN. |

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

The AI runtime returns `AgentResult.needsHuman`, detected intent, and a structured reason code. Application logic—not assistant prose—maps those signals to `CUSTOMER_REQUEST`, `LOW_CONFIDENCE`, `PURCHASE_INTENT`, or `COMPLAINT` and performs the actual guarded mode transition. A successful AI turn may send its one short customer-facing acknowledgement and atomically move the conversation to HUMAN; later inbound messages are stored without another AI response. Out-of-scope redirects do not escalate. Provider/runtime failures move an unchanged AI conversation to HUMAN with LOW_CONFIDENCE and preserve the inbound failure state rather than inventing a reply.

## Takeover

1. The conversation is marked for attention with a reason.
2. An authorized employee switches it to HUMAN.
3. New inbound messages continue to be normalized, deduplicated, persisted, and displayed.
4. No AI reply is sent while HUMAN is active.
5. Staff replies use the same WhatsApp transport and message persistence path.

Manual takeover assigns the current authorized BusinessUser and stores MANUAL. An automatically escalated conversation initially remains unassigned; the first authorized manual reply claims it for that membership. Assignment uses a same-business composite foreign key and cannot reference another tenant.

## Return to AI

Returning control is an explicit authorized action. Before the next automatic reply, the server should use the current conversation state and business data; it must not replay a stale pending AI response.

Human lead classifications and other manual decisions remain authoritative after returning to AI unless deliberately changed.

Returning to AI or pausing clears assignment, handoff reason, and pending customer actions. Takeover, pause, and return-to-AI transitions are audited. A conversation control version is incremented on each transition and reserved reply; an AI or human reply can be committed only against the version and mode it originally observed. Canonical outbound persistence also creates its PENDING WhatsApp transport reservation atomically. Mode changes and additional replies are rejected until that reservation becomes SENT or FAILED, so whichever server-side control or send reservation commits first defines the safe ordering.

## Open Questions

- Conversation status currently reserves OPEN and CLOSED, but closing/reopening and multiple historical threads per customer are not yet product-defined.
- Follow-up and reactivation modules must enforce PAUSED when they are implemented; no such scheduler exists yet.
- Whether returning to AI later requires a staff summary is not yet specified; current bounded persisted history is used without an extra summary.
