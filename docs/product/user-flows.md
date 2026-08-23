# User flows

These flows describe intended product behavior, not implementation tasks.

## Customer receives a grounded answer

    Customer sends a WhatsApp question
      -> receiving number identifies the business
      -> message and conversation are persisted
      -> shared agent receives authorized business context
      -> tenant-bound tool retrieves current facts when needed
      -> answer is persisted and sent through Meta

If a required fact is missing, stale, or untrustworthy, the system asks for clarification or moves the conversation toward human attention rather than inventing an answer.

## Employee takes over

    AI or deterministic rule identifies a handoff condition
      -> conversation records a reason and needs attention
      -> employee opens the inbox and switches to HUMAN
      -> incoming messages continue to be stored
      -> AI does not reply
      -> employee replies through the dashboard and WhatsApp transport
      -> employee deliberately returns control to AI when appropriate

## Conversation becomes a lead

    Customer expresses meaningful purchase or booking interest
      -> structured intent and deterministic qualification rules are evaluated
      -> lead is created or updated without duplicating the active opportunity
      -> evidence links back to the qualifying message/conversation
      -> staff can review, override, and progress the lead

A basic information question is not automatically a lead.

## Interested customer becomes inactive

    Eligible lead becomes inactive
      -> pending follow-up is stored
      -> customer reply cancels or supersedes it
      -> scheduled worker claims the due follow-up
      -> final eligibility, mode, quiet-hour, frequency, and compliance checks run
      -> eligible message is sent once and its outcome is persisted

## Previous customer is reactivated later

    Customer lifecycle history
      -> deterministic segment
      -> staff previews recipients and message/template
      -> current consent and Meta eligibility checks
      -> campaign sends through WhatsApp
      -> delivery, replies, and known conversions are measured

## Business maintains its information

    Owner signs in
      -> authorized business is resolved
      -> owner updates profile, hours, rules, schema, or entities
      -> server validates and persists the change
      -> source/freshness and audit information are updated
      -> the next AI lookup sees the new value without retraining or redeploying
