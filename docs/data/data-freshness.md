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

## Initial and future sources of truth

PostgreSQL is the initial source of truth for data maintained through the dashboard. BusinessDataProvider gives the application and AI a stable access boundary:

    tenant-bound caller
      -> BusinessDataProvider
      -> DatabaseProvider initially
      -> future booking, POS, commerce, CRM, or custom provider when justified

An external provider may later become authoritative for particular facts. Integrations should supplement or replace those facts without redesigning the agent.

## Request-time retrieval

Stable instructions may include compact business identity and policies. Prices, availability, current catalog records, and other mutable facts should be queried when the response needs them.

Changing a value through the dashboard or an authorized provider must affect the next relevant lookup without retraining, restarting, or redeploying the agent.

If a value is absent, stale, or cannot be verified at its required freshness level, tools return that state explicitly. The agent asks for clarification or hands off rather than presenting the value confidently.

## Auditability

For an important change, the system should be able to answer:

- which business and record changed;
- who or what changed it;
- when it changed;
- the previous and new values;
- the source or provider responsible.

## Open Questions

- Is freshness classified and measured per entity type, record, individual field, or a combination? Mixed JSONB records may contain facts with different volatility.
- When manual and synchronized values disagree, which provider has precedence and can a manual override expire?
- Customer-local versus business-local time for freshness and messaging eligibility is not fully specified.
