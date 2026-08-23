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

Each follow-up belongs to a business, lead, and conversation and records its schedule, type/content, attempt count, and state:

- PENDING;
- SENT;
- CANCELLED;
- FAILED.

Business configuration controls whether follow-ups are enabled and their initial delay. Policy is not hard-coded globally.

## Scheduling and cancellation

An eligible inactive conversation creates the intended pending record without duplication. A customer reply before sending cancels or supersedes the pending follow-up.

A recurring Mastra workflow queries and safely claims due records so work survives restarts and concurrent workers cannot send the same attempt independently.

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

## Retry behavior

Retry only failures classified as transient. Use bounded attempts/backoff and a stable outbound identity so a timeout cannot lead to an unbounded duplicate send. Permanent failures become FAILED and remain visible.

## Anti-spam principles

- Cap follow-ups per lead, customer, and time period.
- Never create automated reply loops.
- Honor customer activity, opt-out, business state, and human control.
- Keep content relevant to the evidenced interest.
- Make automation inspectable and disableable by the business.

## Open Questions

- Quiet hours are described as business/customer messaging windows, but the controlling timezone and customer-local information are not yet defined.
- Applicable WhatsApp compliance is explicit in later reactivation work but must also be resolved before automatic follow-ups can send.
- The exact database claiming/outbox strategy and behavior after an ambiguous provider timeout remain implementation decisions.
