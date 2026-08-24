# Conceptual data model

This document defines domain responsibilities and relationships. It does not prescribe a final SQL or ORM schema.

## Identity and tenant

- **Business** is the tenant root and stores stable business-level configuration such as category, timezone, currency, language, and lifecycle state.
- **User** represents an authenticated platform identity.
- **BusinessUser** authorizes a user within a business and carries the business role. Initial roles are OWNER and STAFF.
- **WhatsAppConnection** maps a Meta receiving phone number identity to exactly one business.

Business category is an extensible uppercase key such as `CAR_RENTAL`, not a closed database enum. The default language is a normalized lowercase language tag so future languages do not require schema changes. Business lifecycle is distinct from billing state and uses the explicit `ACTIVE`, `INACTIVE`, and `SUSPENDED` states. Creation requires timezone, currency, language, and lifecycle explicitly; the persistence model does not assume Morocco-specific defaults.

User identity uses a unique, canonical lowercase email. Better Auth owns the canonical `User`, `Session`, `Account`, and `Verification` persistence models. Password authentication stores only Better Auth's credential hash on the credential `Account`; `User` has no plaintext or password-hash field. `BusinessUser` remains the separate application authorization join, enforces one membership per user/business pair, and carries `OWNER` or `STAFF`.

## Business configuration

- **BusinessRule** represents an explicit, categorized, active or inactive policy used by application and AI decisions.
- Opening hours and profile information belong to the business configuration domain.
- **BusinessEntityType**, **BusinessFieldDefinition**, and **BusinessEntity** represent configurable business catalogs. See [dynamic business data](dynamic-business-data.md).

## Customer communication

- **Customer** is a tenant-owned contact. A WhatsApp sender resolves to a customer only after the receiving business is known.
- **Conversation** links a business and customer, stores control mode and operational status, may be assigned to a user, and tracks activity.
- **Message** belongs to a business and conversation and records direction, sender type, content, external transport identity/state, and time.

Messages preserve the interaction history used by the application. They are not an authoritative store for current business facts mentioned in old conversations.

## Sales and automation

- **Lead** links the business, customer, and originating conversation. It stores lifecycle state, intent, optional summary/score, and evidence for qualification.
- **FollowUp** links to a lead and conversation and records the durable schedule, content/type, attempt count, and PENDING, SENT, CANCELLED, or FAILED state.
- **CustomerEvent** records completed or significant business outcomes such as a purchase, service, booking, or membership lifecycle event.
- **Campaign** represents later previous-customer reactivation: segment definition, message/template, status, and outcomes.

## Key relationships

    Business
      -> BusinessUser -> User
      -> business configuration and rules
      -> BusinessEntityType -> BusinessFieldDefinition
                            -> BusinessEntity
      -> WhatsAppConnection
      -> Customer -> Conversation -> Message
                  -> CustomerEvent
      -> Lead -> FollowUp
      -> Campaign

Every tenant-owned relation must remain within one business. Direct businessId scoping and parent relationships must agree.

## Operational data

Audit entries, idempotency records, delivery events, agent/tool traces, evaluation results, errors, and usage metrics support operation of the domain. They are not substitutes for domain records and should carry only the tenant and sensitive data needed for their purpose.

## Lifecycle principles

- Prefer explicit status and archival semantics over destructive deletion when history is referenced by conversations or analytics.
- Human decisions override AI-derived lead or handoff classifications.
- External identities such as Meta message IDs require uniqueness/idempotency behavior in the appropriate tenant or provider scope.
- Schema and authorization constraints should prevent impossible cross-tenant relationships, not merely hide them in the UI.

## Open Questions

- Conversation mode is defined, but the separate conversation status vocabulary is not yet specified.
- The persistence models for opening hours and BusinessRule, including precedence and effective dates, are not yet fully defined.
- The later migration from STAFF to OWNER, MANAGER, and AGENT role vocabulary needs an explicit compatibility plan.
