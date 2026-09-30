# Automatic follow-ups

## Purpose

Follow-ups recover interested leads who stop responding while avoiding spam, stale messages, and conflict with human-controlled conversations.

    qualifying lead interest
      -> inactivity
      -> pending FollowUp record
      -> recurring workflow claims due record
      -> final eligibility check
      -> send or cancel

Follow-ups are durable database state, not in-memory timers.

## FollowUp lifecycle

Each follow-up belongs to one business, lead, conversation, and customer. It records the customer-activity baseline, schedule, content, attempt count, linked canonical outbound message, and state:

- PENDING;
- SENT;
- CANCELLED;
- FAILED.

`PROCESSING` and `SENDING` are internal claim/send phases. PostgreSQL permits only one active (pending or in-flight) INITIAL follow-up per business/lead. Stale in-flight claims become `FAILED / INDETERMINATE_ATTEMPT` rather than being blindly resent after a restart.

Business configuration controls enablement, initial delay in minutes, messaging window, maximum sends per lead, and minimum interval per customer. It defaults to disabled. Owners edit policy in the dashboard. Staff may record a customer-specific explicit opt-in attestation; inbound `STOP` and other exact opt-out commands and staff withdrawal revoke it. A commercial inquiry alone is not treated as consent.

## Scheduling and cancellation

An eligible opted-in lead creates a pending record at the canonical latest customer message's `createdAt` plus that business's delay. This is the inactivity baseline; automated replies do not schedule follow-ups. Any next customer message cancels pending/processing work in the same transaction that stores the canonical message. New meaningful lead evidence may create a new pending record from that newer customer activity. Terminal lead changes and manual HUMAN/PAUSED transitions cancel pending work.

A Mastra scheduled workflow runs every minute on a long-lived server and scans PostgreSQL for due records. Conditional `PENDING -> PROCESSING -> SENDING` transitions prevent duplicate claims. A PostgreSQL customer-scoped advisory transaction lock serializes customer replies, consent/mode changes, and the final send transition. Once a provider request starts, an already in-flight send cannot be recalled; later replies cannot retroactively unsend it.

## Final eligibility guard

Immediately before sending, recheck:

- no relevant customer reply has arrived;
- the lead is still eligible and not in a terminal state;
- the conversation is not under human control or otherwise paused from this automation;
- the business is active and follow-ups remain enabled;
- quiet-hour and frequency limits allow sending;
- current Meta eligibility, template, consent, and messaging rules allow the message;
- the attempt has not already produced the external side effect.

Any failed check cancels, postpones, or leaves the record pending according to an explicit reason; it does not silently send.

The current Meta transport only supports free-form text. The worker checks the trusted inbound Meta timestamp where available and refuses free-form sends at or beyond 24 hours after the last customer message (`TEMPLATE_REQUIRED`). A delayed quiet-hours slot that crosses this boundary fails closed. An approved-template transport and its category/consent management are required before longer delays may send.

## Retry behavior

Only definite provider rejections (429 and 5xx) retry, at most three attempts with exponential backoff. The same canonical outbound message and transport ledger row are reused. Network/timeouts, invalid responses, process death during an in-flight attempt, and uncertain persistence are ambiguous and become FAILED for manual reconciliation; they are never blindly resent. A 400 or credential/configuration failure is permanent.

## Anti-spam principles

- Cap sent follow-ups per lead (1-3) and enforce a minimum interval between customer sends; concurrent customer sends use a database advisory lock.
- Never create automated reply loops.
- Honor customer activity, opt-out, business state, and human control.
- Keep content relevant to the evidenced interest.
- Make automation inspectable and disableable by the business.

## Current limits

Quiet hours use the business timezone; customer-local timezone is not collected yet. Staff must verify and record explicit customer consent before enabling a customer's follow-ups. The current free-form WhatsApp transport cannot send outside Meta's 24-hour customer-service window. Approved-template sending for longer delays is deferred. A provider timeout or interrupted in-flight send is treated as indeterminate and requires manual reconciliation rather than an automatic retry.
