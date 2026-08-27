# Request flows

## Dashboard request

    React request
      -> validate Better Auth server-side cookie session
      -> read x-business-id as an untrusted selector
      -> query BusinessUser by verified userId plus selected businessId
      -> construct TenantContext from the authorized membership
      -> validate route input
      -> bind tenant-scoped domain service/repository to TenantContext
      -> transaction writes business change + AuditEvent for audited mutations
      -> PostgreSQL
      -> safe response

The requested business must be derived from an authorized membership selection. Supplying an ID is not authorization; userId comes only from the verified session, while role and membershipId come only from PostgreSQL. The dashboard path does not infer a tenant when the selector is absent. After resolution, routes pass the trusted context rather than the selector; repositories extract `tenant.businessId` and add it directly to ownership-sensitive Prisma queries.

Business configuration requests then load or change profile, regular hours, rules, generic schemas, or generic entities through their owning services. The read-only business-understanding route assembles those current sources at request time and does not read or write a duplicated context document.

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

The initial provider is DatabaseBusinessDataProvider. Every call delegates to current tenant-scoped services and performs the required PostgreSQL reads at call time. Source and freshness status travel with factual results; no agent, module global, or session-held context blob substitutes for that lookup.

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
