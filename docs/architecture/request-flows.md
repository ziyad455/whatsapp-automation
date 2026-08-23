# Request flows

## Dashboard request

    React request
      -> authenticate user/session
      -> resolve and authorize business membership
      -> construct TenantContext
      -> validate route input
      -> tenant-scoped domain service/repository
      -> PostgreSQL
      -> safe response

The requested business must be derived from an authorized membership selection. Supplying an ID is not authorization.

## WhatsApp inbound request

    Meta webhook
      -> verify endpoint challenge or validate payload signature
      -> validate and normalize supported event
      -> deduplicate by external message/event identity
      -> map receiving phoneNumberId to exactly one business
      -> construct TenantContext
      -> resolve/create tenant customer and conversation
      -> persist inbound message
      -> apply server-side conversation mode and escalation logic
      -> generate AI response or await human action
      -> persist and send outbound message

Raw Meta payload details stop at the transport adapter. Domain and AI code use normalized internal messages.

## AI fact lookup

    Agent run
      -> already-authorized TenantContext
      -> tenant-bound tool
      -> BusinessDataProvider
      -> current PostgreSQL or external-provider fact
      -> limited, validated tool result
      -> grounded response or explicit unknown/stale result

The model does not provide businessId to the tool.

## Human reply

    Dashboard action
      -> authenticate and authorize staff
      -> enforce conversation mode and action permission
      -> persist outbound human message
      -> WhatsApp transport sends message
      -> delivery/read/failure events update transport state

## Scheduled follow-up

    Recurring workflow
      -> claim due database record safely
      -> rebuild TenantContext from trusted application data
      -> recheck lead, conversation, customer, business, timing, and policy
      -> send at most once for the claimed attempt
      -> persist sent, retryable failure, final failure, or cancellation
