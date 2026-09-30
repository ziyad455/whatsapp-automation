# Customer reactivation

Customer reactivation is a later capability built after the core WhatsApp MVP is usable. It helps businesses contact previous customers when a genuine lifecycle reason exists.

    completed customer event/history
      -> deterministic eligible segment
      -> campaign and recipient preview
      -> compliance and opt-out checks
      -> approved WhatsApp message/template
      -> delivery, reply, and known conversion outcomes

## Customer history

CustomerLifecycleEvent records factual outcomes such as completed booking, purchase, service, membership start, or membership expiry. A lifecycle event may reference a same-business lead, conversation, or business entity. It is never inferred from customer intent or assistant prose.

## Segmentation

Segments are deterministic and previewable. Examples include customers inactive for a defined period, customers who previously rented, expiring memberships, or a completed service followed by an appropriate interval.

The segment definition, not a model guess, determines recipients.

Customer inactivity uses the latest persisted inbound customer message, or customer creation when no inbound history exists. It does not use an outbound automation message as proof of customer activity.

## Campaign controls

A Campaign stores the business, name, segment definition, message or template, state, and timestamps. Before launch, staff must see the recipient count/list and final content so a business cannot send blindly.

Promotional opt-out is stored and enforced during selection and again before sending.

Preparing a campaign creates a durable CampaignRecipient snapshot. Launching only marks that snapshot for DB-driven processing. Each recipient is claimed atomically and rechecked under a customer-scoped database lock before the provider request. Restarted workers do not resend a SENT recipient, and ambiguous transport failures are not retried blindly.

## Compliance

The September 2026 implementation follows the current [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/): the business must have the recipient's number and opt-in permission, must honor opt-out requests, may initiate a conversation only with an approved template, and may use free-form replies only inside the 24-hour customer-service window. Reactivation uses a Meta-verified approved MARKETING template even if a recent service window exists. This stricter rule keeps promotional campaign behavior explicit.

Application eligibility requires all of the following:

- current marketing consent with no later opt-out;
- an active business and active tenant WhatsApp connection;
- an approved MARKETING template verified from the connected WABA;
- an eligible open AI-controlled WhatsApp conversation;
- no sent promotional campaign for the customer in the previous 30 days.

Segment membership is not permission to send. The same eligibility guard runs during preview and immediately before transport.

No documentation should encode temporary policy assumptions as permanent rules.

## Measurement

Track provider acceptance, delivery, read, reply, failure, and conversion separately. A reply uses deterministic most-recent-campaign attribution within 14 days. A conversion requires a factual CustomerLifecycleEvent within 30 days after the most recent sent campaign. Delivery alone is not proof of business value.

## Open Questions

- Campaign approval roles and cancellation behavior need definition before implementation.
- Pilot and production teams still need a legal review of the evidence accepted as marketing consent in each operating jurisdiction.
