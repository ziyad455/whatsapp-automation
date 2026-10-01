# Project documentation

This directory is the permanent technical context for the WhatsApp Automation project. It explains how the product is designed, which invariants implementation must preserve, and how the major parts fit together.

The active [Notion roadmap](https://app.notion.com/p/3c5b345946ad8107bbacd6efa262bedc) remains the authority for sprints, tasks, sequencing, status, acceptance points, and Definitions of Done. These documents deliberately do not reproduce that plan.

    Notion     -> what and when to build
    docs/      -> architecture, product rules, and implementation constraints
    source     -> the behavior that is currently implemented

An Open Questions section records unresolved roadmap details. It is not permission to choose an answer implicitly; resolve the question in the appropriate design or task before depending on it.

## How future agents should use these docs

Before implementing a task, read only the documents relevant to that task plus the listed dependencies. Do not read the entire documentation set by default. Then read the affected source files and the exact Notion task.

| Work area | Required context |
| --- | --- |
| Product scope or feature behavior | [Product overview](product/product-overview.md), [scope and principles](product/scope-and-principles.md), [user flows](product/user-flows.md) |
| Foundation or component boundaries | [System architecture](architecture/system-architecture.md), [architectural decisions](architecture/architectural-decisions.md), [server architecture](backend/server-architecture.md), or [dashboard architecture](frontend/dashboard-architecture.md) |
| Authentication or authorization | [Multi-tenancy](architecture/multi-tenancy.md), [data model](data/data-model.md), [security principles](engineering/security-principles.md) |
| Dynamic business data | [Multi-tenancy](architecture/multi-tenancy.md), [data model](data/data-model.md), [dynamic business data](data/dynamic-business-data.md), [data ownership](data/data-ownership.md) |
| Business-data freshness or integrations | [Data freshness](data/data-freshness.md), [data ownership](data/data-ownership.md), [agent context](ai/agent-context.md) |
| Shared agent or prompt/context work | [AI architecture](ai/ai-architecture.md), [agent context](ai/agent-context.md), [tools and guardrails](ai/tools-and-guardrails.md), [multi-tenancy](architecture/multi-tenancy.md) |
| AI tool | [Multi-tenancy](architecture/multi-tenancy.md), [AI architecture](ai/ai-architecture.md), [tools and guardrails](ai/tools-and-guardrails.md), [data freshness](data/data-freshness.md) |
| AI evaluation | The relevant AI documents plus [testing strategy](engineering/testing-strategy.md) |
| WhatsApp webhook or transport | [Multi-tenancy](architecture/multi-tenancy.md), [WhatsApp architecture](whatsapp/whatsapp-architecture.md), [message lifecycle](whatsapp/message-lifecycle.md), [security principles](engineering/security-principles.md) |
| Conversations or handoff | [Message lifecycle](whatsapp/message-lifecycle.md), [human handoff](ai/human-handoff.md), [data model](data/data-model.md), [dashboard architecture](frontend/dashboard-architecture.md) |
| Leads | [Leads](automation/leads.md), [data model](data/data-model.md), [human handoff](ai/human-handoff.md) |
| Follow-ups | [Follow-ups](automation/follow-ups.md), [leads](automation/leads.md), [error handling](engineering/error-handling.md), [message lifecycle](whatsapp/message-lifecycle.md) |
| Customer reactivation | [Customer reactivation](automation/customer-reactivation.md), [data model](data/data-model.md), [WhatsApp architecture](whatsapp/whatsapp-architecture.md) |
| Operating analytics | [Operating analytics](analytics/operating-analytics.md), [dashboard architecture](frontend/dashboard-architecture.md), [multi-tenancy](architecture/multi-tenancy.md) |
| Dashboard feature | [Dashboard architecture](frontend/dashboard-architecture.md) plus the relevant domain document |
| Server feature | [Server architecture](backend/server-architecture.md), [request flows](architecture/request-flows.md), plus the relevant domain document |
| Security, failure, or production hardening | [Security principles](engineering/security-principles.md), [error handling](engineering/error-handling.md), [testing strategy](engineering/testing-strategy.md) |

For example:

    S3 dynamic business data task
      -> architecture/multi-tenancy.md
      -> data/data-model.md
      -> data/dynamic-business-data.md

    S7 AI tool task
      -> architecture/multi-tenancy.md
      -> ai/ai-architecture.md
      -> ai/tools-and-guardrails.md
      -> data/data-freshness.md

    S9 WhatsApp task
      -> architecture/multi-tenancy.md
      -> whatsapp/whatsapp-architecture.md
      -> whatsapp/message-lifecycle.md

## Documentation map

- product/ — product purpose, scope, principles, and user-visible flows.
- architecture/ — system boundaries, request paths, tenant isolation, and durable technical decisions.
- data/ — conceptual entities, dynamic schemas and JSONB, ownership, sources, and freshness.
- ai/ — the shared agent, request context, tenant-bound tools, safety, and human handoff.
- whatsapp/ — the Meta transport boundary and message lifecycle.
- automation/ — leads, automatic follow-ups, and later customer reactivation.
- analytics/ — metric definitions, reporting boundaries, and audience rules.
- frontend/ — responsibilities and boundaries of dashboard/.
- backend/ — responsibilities and separation of concerns in server/.
- engineering/ — cross-cutting security, failure, testing, and coding expectations.

## Project-wide invariants

Security and operations references: [authorization](engineering/authorization.md),
[operations runbook](engineering/operations-runbook.md),
[database recovery](engineering/database-recovery.md),
[security/index audit evidence](engineering/sprint-15-audit.md), and
[AI action boundaries](ai/action-boundaries.md).

1. One shared application serves many businesses, but tenant data never crosses business boundaries.
2. Every tenant-owned operation runs inside an authorized TenantContext.
3. The client and the AI are never trusted to select an unrestricted businessId.
4. Platform/domain data is strongly typed; business-specific catalog attributes use validated, schema-defined JSONB.
5. PostgreSQL or an authorized external provider supplies current business facts. The LLM, prompt, and conversation history are not sources of truth.
6. Current or volatile facts are retrieved through tenant-bound tools at request time.
7. Humans can stop AI replies, act manually, and return control deliberately.
8. External side effects are authorized, validated, idempotent, observable, and safely retryable.
9. New infrastructure, integrations, and vertical-specific behavior require demonstrated business need.
10. Business understanding is assembled from authoritative profile, hours, rules, schemas, and entities; no duplicate context blob becomes a source of truth.

## Keeping documentation current

Update the smallest relevant document when an architectural decision changes. Keep task status and sprint details in Notion. Avoid copying the same explanation into several files; link to its owning document instead.
