# Operating analytics

Operating analytics help an owner or staff member decide what to do next. The business dashboard prioritizes conversations waiting for a human, due or failed follow-ups, active leads, campaign outcomes, and recently recorded customer outcomes. Technical model usage and cost are platform-internal data and are not returned by normal business-owner analytics routes.

## Authorization and time

Every query derives `businessId` from an authorized `TenantContext`. IDs and range values sent by the browser are selectors, never authorization. Reporting periods use the business timezone and local calendar-day boundaries. Supported periods are today, the last 7 calendar days, and the last 30 calendar days.

The attention and follow-up queues describe current operational state rather than historical period state. `Conversation.attentionSince` begins when the conversation enters `HUMAN` mode and clears when it leaves that mode, so waiting time does not depend on conversation creation time.

## Metric definitions

- Conversations are distinct WhatsApp conversations with a non-system canonical message in the reporting period.
- New leads are leads created in the reporting period. Active leads are current `NEW`, `INTERESTED`, or `QUALIFIED` records. Historical lead-stage transitions are not inferred because the current model does not persist a status-event ledger.
- A due follow-up is `PENDING` with `scheduledAt` at or before the query time. Future pending, failed, and recent terminal records are separate views.
- Campaign delivery, reply, and conversion rates use sent recipients as the denominator. A zero denominator produces an unknown rate, displayed as an em dash rather than zero.
- Conversation response time pairs the most recent inbound customer message in a consecutive inbound burst with the first subsequent direct AI or human response. Follow-up and campaign messages are excluded.
- A fully AI-handled conversation has an inbound customer message and direct AI response in the period, with no human response or handoff in that period.
- Campaign conversions come only from attributed campaign recipient conversion timestamps. Customer lifecycle events remain the factual customer-history record.

## AI usage

AI usage is recorded after each model attempt without changing the model call result. Usage persistence failure is logged safely and does not fail a successful customer reply. Cost is estimated only when the application has a trusted price for the exact provider/model pair and both input and output token counts. Dynamic or unknown OpenRouter pricing remains unknown rather than being guessed.
