# Customer reactivation

Customer reactivation is a later capability built after the core WhatsApp MVP is usable. It helps businesses contact previous customers when a genuine lifecycle reason exists.

    completed customer event/history
      -> deterministic eligible segment
      -> campaign and recipient preview
      -> compliance and opt-out checks
      -> approved WhatsApp message/template
      -> delivery, reply, and known conversion outcomes

## Customer history

CustomerEvent records meaningful outcomes such as completed booking, purchase, service, membership start, or membership expiry. Staff can inspect this history without searching old chats manually.

## Segmentation

Segments are deterministic and previewable. Examples include customers inactive for a defined period, customers who previously rented, expiring memberships, or a completed service followed by an appropriate interval.

The segment definition, not a model guess, determines recipients.

## Campaign controls

A Campaign stores the business, name, segment definition, message or template, state, and timestamps. Before launch, staff must see the recipient count/list and final content so a business cannot send blindly.

Promotional opt-out is stored and enforced during selection and again before sending.

## Compliance

At implementation time, verify current Meta requirements for templates, consent, outbound eligibility, messaging windows, opt-out, and any applicable legal obligations. Sending logic blocks ineligible recipients rather than relying only on UI warnings.

No documentation should encode temporary policy assumptions as permanent rules.

## Measurement

Track sent, delivered, replied, and converted outcomes where conversion evidence exists. Delivery alone is not proof of business value.

## Open Questions

- The source and legal meaning of consent for pilot and production customers are not yet specified.
- Attribution rules for conversion after a campaign are not defined.
- Campaign approval roles and cancellation behavior need definition before implementation.
