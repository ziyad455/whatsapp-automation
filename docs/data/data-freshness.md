# Data freshness

Business facts have different rates of change and must not all be treated alike.

| Classification | Meaning | Example |
| --- | --- | --- |
| STABLE | Rarely changes and is usually safe until edited | address, description |
| CHANGING | Changes periodically and should carry update/verification context | price, service details |
| REAL_TIME | Can change between customer messages and requires a current provider lookup | availability, stock, appointment slot |

The classification describes how cautiously a fact is used. It does not make stale data current.

## Source metadata

Mutable business information should be traceable through:

- source: initially MANUAL, IMPORT, API, SYNC, or SYSTEM;
- optional external identifier;
- updatedAt;
- optional lastVerifiedAt;
- optional staleness policy such as staleAfter;
- actor and before/after values in an audit log where appropriate.

Archival preserves historical references when a service or item is no longer offered.

The implemented storage follows the shape of each fact rather than adding provenance to every table:

- Business carries `profileSource`, optional `profileExternalId`, and optional `profileLastVerifiedAt` for the profile fields stored on the tenant root.
- BusinessOpeningHour and BusinessRule carry record-level source, optional external ID, and verification time because each row is a factual unit.
- BusinessEntity carries record-level source, optional external ID, and verification time. Its BusinessFieldDefinition records carry field-level `freshnessClass` and optional `staleAfterSeconds`, allowing stable brand, changing price, and real-time availability to coexist in one entity.
- Structural identity and authorization records, field definitions themselves, and AuditEvent do not receive generic source metadata.

Ordinary dashboard mutation services set source to MANUAL and do not accept source or external ID as browser-controlled fields. External IDs are nullable and not globally unique; provider-specific uniqueness waits for a real integration requirement.

## Verification and staleness

`updatedAt` records when stored business data changed. `lastVerifiedAt` records when a user or trusted system confirmed the fact was current. Verification can advance `lastVerifiedAt` without changing the business value or its `updatedAt` timestamp.

Freshness is calculated centrally from `lastVerifiedAt`, optional `staleAfterSeconds`, and a caller-supplied reference time:

- no verification time returns UNKNOWN, even if `updatedAt` is recent;
- a verified fact with no expiry returns FRESH;
- a verified fact with an expiry is FRESH before `lastVerifiedAt + staleAfterSeconds` and STALE at or after that boundary.

STABLE, CHANGING, and REAL_TIME classify volatility; they do not imply universal TTLs. TTL remains explicitly configurable where the business schema has a meaningful policy.

## Initial and future sources of truth

PostgreSQL is the initial source of truth for data maintained through the dashboard. BusinessDataProvider gives the application and AI a stable access boundary:

    tenant-bound caller
      -> BusinessDataProvider
      -> DatabaseProvider initially
      -> future booking, POS, commerce, CRM, or custom provider when justified

An external provider may later become authoritative for particular facts. Integrations should supplement or replace those facts without redesigning the agent.

The current DatabaseBusinessDataProvider is bound to TenantContext and delegates to existing tenant-scoped domain/query services. Its current-data results include source and FRESH, STALE, or UNKNOWN metadata where relevant. It reuses the centralized Prisma connection but retains no business result snapshot.

## Request-time retrieval

Stable instructions may include compact business identity and policies. Prices, availability, current catalog records, and other mutable facts should be queried when the response needs them.

Changing a value through the dashboard or an authorized provider must affect the next relevant lookup without retraining, restarting, or redeploying the agent.

If a value is absent, stale, or cannot be verified at its required freshness level, tools return that state explicitly. The agent asks for clarification or hands off rather than presenting the value confidently.

The AI projection currently withholds STALE/UNKNOWN tool values as null while preserving freshness/source labels. Stable instruction data retains its metadata and must not be promoted to a verified fact merely because it is in a prompt. Default CHANGING opening hours are read through the tool; only explicitly STABLE normal hours enter BusinessContext. Rule/profile changes rebuild the next run's configuration, while catalog updates are visible on the next tool read.

## Auditability

For an important change, the system should be able to answer:

- which business and record changed;
- who or what changed it;
- when it changed;
- the previous and new values;
- the source or provider responsible.

AuditEvent is an append-only, tenant-owned domain record. Existing profile, hours, rule, catalog-entity, and safe schema mutations write a redacted before/after JSONB snapshot in the same PostgreSQL transaction as the change. Dashboard actors come from TenantContext; future SYSTEM and INTEGRATION actor kinds do not require a fake user.

## Open Questions

- When manual and synchronized values disagree, which provider has precedence and can a manual override expire?
- Customer-local versus business-local time for freshness and messaging eligibility is not fully specified.
