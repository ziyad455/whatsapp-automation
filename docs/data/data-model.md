# Conceptual data model

This document defines domain responsibilities and relationships. It does not prescribe a final SQL or ORM schema.

## Identity and tenant

- **Business** is the tenant root and stores stable business-level configuration such as category, timezone, currency, language, and lifecycle state.
- **User** represents an authenticated platform identity.
- **BusinessUser** authorizes a user within a business and carries the business role. Initial roles are OWNER and STAFF.
- **WhatsAppConnection** maps a Meta receiving phone number identity to exactly one business.

Business category is an extensible uppercase key such as `CAR_RENTAL`, not a closed database enum. The default language is a normalized lowercase language tag so future languages do not require schema changes. Business lifecycle is distinct from billing state and uses the explicit `ACTIVE`, `INACTIVE`, and `SUSPENDED` states. Creation requires timezone, currency, language, and lifecycle explicitly; the persistence model does not assume Morocco-specific defaults.

User identity uses a unique, canonical lowercase email. Better Auth owns the canonical `User`, `Session`, `Account`, and `Verification` persistence models. Password authentication stores only Better Auth's credential hash on the credential `Account`; `User` has no plaintext or password-hash field. `BusinessUser` remains the separate application authorization join, enforces one membership per user/business pair, and carries `OWNER` or `STAFF`. Dashboard tenant resolution uses that compound membership as the authorization record; it does not add `businessId` to `User` or duplicate memberships in Better Auth Organizations.

## Business configuration

- **BusinessRule** represents an explicit, categorized, active or inactive policy used by application and AI decisions.
- **BusinessOpeningHour** stores one relational local-time schedule row per business and weekday. A closed day has no times; an open day has one opening and closing time with closing later than opening.
- Business profile information belongs to Business and includes optional public description, phone, and address plus currency, timezone, default language, and supported languages.
- **BusinessEntityType**, **BusinessFieldDefinition**, and **BusinessEntity** represent configurable business catalogs. See [dynamic business data](dynamic-business-data.md).

BusinessEntityType is directly tenant-owned, has a tenant-local key, and versions its schema contract. BusinessFieldDefinition inherits tenant ownership through its entity type and separates immutable `key` identity from editable `label`, ordering, requirement, options, type, and enabled state. BusinessEntity is directly tenant-scoped and references its type through a same-business composite relationship; its validated configurable values live in JSONB while identity, ownership, type, lifecycle status, and timestamps stay relational.

Mutable business facts carry provenance only where the persisted record is an authoritative factual unit. Business profile metadata is named separately on Business; BusinessOpeningHour, BusinessRule, and BusinessEntity carry source, optional external ID, and optional verification time. BusinessRule and opening-hour rows may also carry record-level freshness policy. Dynamic entity volatility and optional TTL are defined per BusinessFieldDefinition so fields in one JSONB record can have different freshness requirements.

## Customer communication

- **Customer** is a tenant-owned contact. The implemented WhatsApp identity stores the provider-normalized numeric sender ID unchanged as `whatsappPhone`; `(businessId, whatsappPhone)` is unique, while the same sender may have separate customer records in different businesses. A WhatsApp sender resolves to a customer only after the receiving business is known.
- **Conversation** is tenant-owned and identifies a persistent thread by channel plus channel-specific participant identity. The current WhatsApp lifecycle uses exactly one durable conversation for `(businessId, WHATSAPP, customerId)`; closing and starting later historical threads is deferred. A WhatsApp conversation carries same-business Customer and WhatsAppConnection references, server-owned `AI`, `HUMAN`, or `PAUSED` mode, `OPEN`/reserved `CLOSED` status, optional same-business assignment, structured handoff reason, activity time, and a control version used by race-safe response commits. Dashboard simulation threads remain separate `DASHBOARD` conversations without customer or transport identity.
- **ConversationMessage** is the canonical complete transcript used by operators, bounded AI context, and later analytics. It belongs directly to a business and same-business conversation and records a monotonic sequence, `INBOUND`/`OUTBOUND` direction, `CUSTOMER`, `AI`, `HUMAN`, or `SYSTEM` sender type, content, time, and optional same-business human sender. Conversation stores a bounded JSON list of validated pending read actions so follow-up acceptance survives refresh without treating assistant prose as executable state.
- **WhatsAppMessage** is the provider transport ledger linked one-to-one where applicable to a canonical ConversationMessage; it is not a second transcript. It binds business, connection, and customer through same-business foreign keys. Inbound rows claim globally unique Meta message IDs and expose explicit processing state; outbound rows retain the Meta message ID and normalized `PENDING`, `SENT`, `DELIVERED`, `READ`, or `FAILED` transport state plus safe milestone/failure metadata. Provider status webhooks update this linked ledger record, so the inbox can present transport state without copying it into conversation history.

Conversation messages preserve bounded interaction context used by the application. They are not an authoritative store for current business facts mentioned in old conversations.

## Sales and automation

- **Lead** links the business, customer, and originating conversation. It stores lifecycle state, intent, optional summary/score, and evidence for qualification.
- **FollowUp** links to a lead and conversation and records the durable schedule, content/type, attempt count, and PENDING, SENT, CANCELLED, or FAILED state.
- **CustomerLifecycleEvent** records completed business outcomes such as a purchase, service, booking, or membership lifecycle event. Events are factual, tenant-scoped records and may reference same-business leads, conversations, or business entities.
- **Campaign** represents later previous-customer reactivation: segment definition, message/template, status, and outcomes.

## Key relationships

    Business
      -> BusinessUser -> User
      -> business configuration and rules
      -> BusinessEntityType -> BusinessFieldDefinition
      -> BusinessEntity ----> BusinessEntityType
      -> AuditEvent
      -> WhatsAppConnection
      -> Conversation -> ConversationMessage
      -> Customer -> persistent WhatsApp Conversation
                  -> CustomerEvent
      -> Lead -> FollowUp
      -> Campaign

Every tenant-owned relation must remain within one business. Direct businessId scoping and parent relationships must agree. BusinessRule and BusinessOpeningHour carry direct business ownership and cascade only with business teardown.

## Operational data

Audit entries, idempotency records, delivery events, agent/tool traces, evaluation results, errors, and usage metrics support operation of the domain. They are not substitutes for domain records and should carry only the tenant and sensitive data needed for their purpose.

AuditEvent is the immutable domain audit entry. It carries business ownership, nullable human actor plus USER/SYSTEM/INTEGRATION kind, target type and target ID, a stable action, redacted before/after JSONB, and creation time. Target identity is polymorphic by type and ID rather than a foreign-key column for every audited model.

## Lifecycle principles

- Prefer explicit status and archival semantics over destructive deletion when history is referenced by conversations or analytics.
- Human decisions override AI-derived lead or handoff classifications.
- External identities such as Meta message IDs require uniqueness/idempotency behavior in the appropriate tenant or provider scope.
- Schema and authorization constraints should prevent impossible cross-tenant relationships, not merely hide them in the UI.

## Open Questions

- Conversation mode is defined, but the separate conversation status vocabulary is not yet specified.
- Holiday hours, temporary closure, multiple daily shifts, overnight schedules, Ramadan schedules, and rule precedence/effective dates remain intentionally undefined beyond the regular weekly MVP model.
- The later migration from STAFF to OWNER, MANAGER, and AGENT role vocabulary needs an explicit compatibility plan.
