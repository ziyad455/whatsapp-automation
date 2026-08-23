# Leads

## Purpose

A lead represents a meaningful sales or booking opportunity discovered in a customer conversation. It is intentionally smaller than a full CRM.

A basic hours, location, or general information question should not create a lead automatically.

## Qualification

Structured intent extraction may identify information seeking, purchase interest, booking interest, complaint, or support. Deterministic application rules decide whether the evidence is strong enough to create or update a lead.

Examples of potential qualifying evidence include a concrete request for price and availability tied to an item/date, a booking attempt, or explicit purchase intent. Exact thresholds belong to business/product rules and evaluation examples.

## Lifecycle

The initial lifecycle is:

    NEW -> INTERESTED -> QUALIFIED -> WON
                                  -> LOST

The roadmap permits staff to move a lead manually. Human decisions override AI categorization.

## Traceability

A lead links to its business, customer, and originating conversation. It retains evidence pointing to the message or event that caused qualification and may include a concise grounded summary of requested item, date, budget, and constraints.

Summaries save staff time but are not substitutes for source messages or current business facts.

## Duplicate avoidance

Conversation events should update an appropriate active opportunity rather than creating a new lead for every qualifying message. Duplicate policy must be deterministic within a tenant.

## Dashboard behavior

Staff should see status, customer, summary, recent activity, and the linked conversation. The dashboard supports review and override; the server owns qualification, persistence, and authorization.

## Open Questions

- The identity of an active opportunity and the rules for multiple simultaneous opportunities from one customer are not yet defined.
- Exact qualification thresholds and whether they can vary by business require product evidence.
- Model score/confidence, if retained, must not override deterministic evidence or staff state.
