# Leads

## Purpose

A lead represents a meaningful sales or booking opportunity discovered in a customer conversation. It is intentionally smaller than a full CRM.

A basic hours, location, or general information question should not create a lead automatically.

## Qualification

Structured intent extraction may identify information seeking, purchase interest, booking interest, complaint, or support. Deterministic application rules decide whether the evidence is strong enough to create or update a lead.

Examples of potential qualifying evidence include a concrete request for price and availability tied to an item/date, a booking attempt, or explicit purchase intent. Exact thresholds belong to business/product rules and evaluation examples.

The application combines structured intent with concrete evidence such as an item or service, date, duration, budget, and commitment language. A greeting, general information request, price question, complaint, support request, or human request does not qualify by itself. Once an active lead exists, a later meaningful budget, date, duration, or item message can strengthen the same opportunity.

## Lifecycle

The initial lifecycle is:

    NEW -> INTERESTED -> QUALIFIED -> WON
                                  -> LOST

Staff may move a lead between any lifecycle statuses in the MVP. A manual change records its source and an audit event. Automatic evidence capture never overwrites a manually selected status and never marks a lead WON or LOST.

## Traceability

A lead links to its business, customer, and originating conversation. Lead evidence references canonical customer messages and database constraints require the lead, conversation, message, and evidence to share the same business and conversation.

The specialized Lead Summary worker receives only evidence loaded and authorized by the application. Its structured output is validated and checked for unsupported concrete facts before persistence. It cannot select tenants, query tools, write records, or change lifecycle state. If initial enrichment fails, the application stores a clearly provisional summary made only from canonical evidence; a later failure preserves any existing summary.

Summaries save staff time but are not substitutes for source messages or current business facts.

## Duplicate avoidance

For the MVP, NEW, INTERESTED, and QUALIFIED are active statuses. A partial database uniqueness constraint permits at most one active lead per business and conversation. WON and LOST remain historical; a later explicit opportunity in the same persistent conversation may create a new active lead. Duplicate evidence for the same lead and message is also prohibited.

## Dashboard behavior

Staff should see status, customer, summary, recent activity, and the linked conversation. The dashboard supports review and override; the server owns qualification, persistence, and authorization.

## Deferred Questions

- Business-specific qualification policies may be introduced only after product evidence shows the generic rules are insufficient.
- Opportunity scoring is intentionally omitted; any future score must not override deterministic evidence or staff state.
