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

## Dashboard agent chat

    React agent chat
      -> Better Auth verifies the HttpOnly session
      -> x-business-id is authorized against BusinessUser membership
      -> dashboard channel adapter constructs trusted TenantContext
      -> resolve dashboard conversation by tenant + channel + authenticated user
      -> validate optional conversationId against that trusted identity
      -> persist inbound customer message
      -> load bounded recent persisted history
      -> runCustomerServiceConversation
      -> runCustomerServiceAgent
      -> shared tenant-bound tools and BusinessDataProvider
      -> application-owned AgentResult
      -> persist assistant reply
      -> conversationId, safe reply, and routing metadata returned to React

The dashboard cannot submit tenant identity or history in the message body. It may send a server-issued conversation ID, but that ID is only a selector: the server requires the conversation's business, channel, and participant identity to match the resolved TenantContext and authenticated user. Refreshing the page reloads a bounded transcript from PostgreSQL. The shared conversation runtime receives only server-authorized history.

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

Dashboard and WhatsApp tenant and conversation resolution remain transport-specific. They converge after each channel has produced a canonical trusted `TenantContext` and authorized conversation identity, then call the same conversation runtime.

## AI fact lookup

    Agent run
      -> already-authorized TenantContext
      -> buildBusinessContext reads current stable configuration
      -> buildBusinessInstructions + bounded recent history
      -> runCustomerServiceAgent creates a fresh validated RequestContext
      -> one registered customer-service agent
      -> tenant-bound tool
      -> BusinessDataProvider
      -> current PostgreSQL or external-provider fact
      -> limited, validated tool result
      -> Mastra plain-text customer reply
      -> application-owned metadata from customer input + run-local tool outcomes
      -> AgentResult or a rejected unsafe/failed invocation

The model does not provide businessId to the tool.

The implemented boundary returns a Zod-validated AgentResult using six narrow read capabilities for profile, hours, active rules, dynamic type discovery, entity search, and exact entity lookup. The model supplies the normal reply text; application code owns intent/language normalization, routing/handoff metadata, localized safe substitution, and the resulting server-side escalation decision. WhatsApp canonical history is complete while only a bounded recent subset enters the agent. A response is committed only if the conversation remains OPEN/AI at the control version observed before generation, and that commit atomically reserves the PENDING outbound transport. Conversation control cannot change until the reserved send reaches SENT or FAILED. Callers enter through the application invocation boundary with trusted business scope and authorized history; arbitrary request payload fields and message text are not tenant resolution. The run capability is invalidated after completion or failure.

The initial provider is DatabaseBusinessDataProvider. Every call delegates to current tenant-scoped services and performs the required PostgreSQL reads at call time. Source and freshness status travel with factual results; no agent, module global, or session-held context blob substitutes for that lookup.

## Human reply

    Dashboard action
      -> authenticate and authorize staff
      -> tenant-scope conversation ID and require OPEN/HUMAN
      -> reserve HUMAN outbound message against control version
      -> use stored customer and WhatsAppConnection
      -> WhatsApp transport creates linked PENDING record and sends
      -> SENT/DELIVERED/READ/FAILED remains visible on canonical history

## Scheduled follow-up

    Recurring workflow
      -> claim due database record safely
      -> rebuild TenantContext from trusted application data
      -> recheck lead, conversation, customer, business, timing, and policy
      -> send at most once for the claimed attempt
      -> persist sent, retryable failure, final failure, or cancellation
