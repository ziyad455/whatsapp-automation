# Error handling

Failures must be safe, visible, classifiable, and recoverable where possible.

## Common rules

- Validate early and return stable, non-sensitive error responses.
- Attach correlation identifiers without logging unnecessary message contents, personal data, or secrets.
- Distinguish transient failures from permanent ones.
- Bound retries and make side effects idempotent.
- Persist important accepted input before depending on external providers.
- Never silently drop a permanently failed workflow; expose it for diagnosis or recovery.

## Validation or authorization failure

Reject the request before domain mutation. Do not reveal whether another tenant's record exists. Record security-relevant patterns with safe metadata.

## LLM failure

Preserve the inbound message, do not send fabricated or malformed output, and mark the conversation for human attention when appropriate. A provider outage must not change tenant scope or bypass conversation mode.

## AI tool failure

Return an explicit unavailable/error state to the agent runtime. Do not let a timeout become an invented fact. Retry only safe, transient reads; side-effecting tools require separate rules.

## Meta failure

Classify authentication, rate-limit, recipient, template/eligibility, validation, and transient network failures. Retry only eligible transient cases. Keep final failures visible and ensure an ambiguous timeout cannot create uncontrolled duplicate messages.

## Database failure

Do not report success for an uncommitted mutation. Roll back local transactions, preserve externally received event identity where the design permits, and allow safe reprocessing. Readiness should report database unavailability separately from process health.

## Scheduled-work failure

Persist attempt state, retry count, last error classification, and next eligible attempt. Use dead-letter/final failure handling after bounded retries. Recheck business state and eligibility on every later attempt.

## Partial external side effects

PostgreSQL and external providers do not share a transaction. Use stable operation identities, idempotency, reconciliation, and status events to handle cases where the provider succeeded but the local acknowledgement failed.

## User-facing behavior

Dashboard errors should explain what the user can safely retry. Customer-facing behavior should prefer no automatic message or a human-attention path over a confident but invalid response.
