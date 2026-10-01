# Sprint 15 database index and secret audit

Evidence collected on 2026-10-01. This document records the read-only index/query and secret-scan audit; it is not a claim that every Sprint 15 deployment requirement is complete. Backup/restore evidence is in [database-recovery.md](database-recovery.md).

## Index coverage and actual query patterns

Reviewed `server/prisma/schema.prisma`, the migration SQL, and the service/repository/worker call sites below. Queried `pg_indexes` on the existing database through the configured connection without printing credentials or row contents. The relevant tables had 54 live indexes, including primary keys and uniqueness constraints. No indexes were added by this audit.

| Query / source | Existing coverage and remaining consideration |
| --- | --- |
| Conversation inbox: `tenant-conversation-inbox.service.ts`, tenant + WHATSAPP + non-null customer, activity descending | `(business_id, last_activity_at DESC)` and tenant/channel uniqueness indexes exist. The final ID tie-break and extra filters are not all covered by the activity index. The outer list has no `take`/cursor. |
| Human attention queue: `dashboard-analytics.service.ts`, tenant/mode/status + attention time | `(business_id, mode, status, attention_since)` exists. Channel/customer filters and activity/ID tie-breaks can still require filtering/sorting. Queue has a bounded `take`. |
| Message history: `tenant-conversation.repository.ts`, tenant + conversation, sequence descending | Unique `(business_id, conversation_id, sequence)` provides the matching tenant/conversation prefix and sequence order; PostgreSQL can scan backward. History has a bounded `take`. |
| Lead lists: `tenant-lead.service.ts`, tenant and optional status, activity descending | `(business_id, status, last_activity_at DESC)` supports the status-filtered pattern. Without a status predicate it does not provide a globally ordered activity stream across all statuses. The dashboard list has no pagination and loads relations, then sorts again in application memory. |
| Follow-up worker: `follow-up-worker.ts`, pending and due schedule | `(status, scheduled_at)` is present and used in the observed due-query plan. Tenant dashboard variants have `(business_id, status, scheduled_at)`. An ID tie-break still required incremental sorting. Stale-claim lookup uses status plus `claimed_at`; no dedicated status/claim-time follow-up index exists. Measure queue size before adding one. |
| Campaign retry worker: `campaign-worker.ts`, pending and due retry time | Working-tree migration `20261001090000_transport_attempt_guards` defines `(status, next_attempt_at)`. The observed source database does **not** yet have `next_attempt_at` or that index. Existing `(status, claimed_at)` supports stale-claim lookup, not the new retry-time predicate. The selected-at/ID ordering is a separate consideration from due filtering. |
| AI usage: `ai-usage.service.ts`, tenant + occurrence range | `(business_id, occurred_at DESC)` exists, as do operation/model variants. The service loads all matching records and aggregates in memory; range indexing alone does not cap result size. |
| Message analytics: `dashboard-analytics.service.ts`, tenant + created range | `(business_id, created_at DESC)` exists. Analytics subsequently order/group by conversation and sequence and load matching rows; the range and final ordering have different index needs. |
| Lifecycle overview: `dashboard-analytics.service.ts`, tenant + occurrence range across customers/types | Existing occurrence indexes include customer or type between tenant and occurrence time. They support those specific filters, but do not fully match the overview's cross-customer/type range/order. A tenant/occurrence index is a candidate to measure with representative volume. |
| Campaign conversion overview: `dashboard-analytics.service.ts`, tenant + conversion range | Existing indexes provide tenant prefixes, but there is no dedicated `(business_id, converted_at)` index. Empty local data cannot justify its write/storage cost; measure production-like conversion queries first. |
| Customer list and reactivation: `customer-lifecycle.service.ts`, `reactivation-segment.ts` | Customer list has no pagination and sorts on updated time; customer indexes are primarily tenant/identity/phone keys. Reactivation outer selection is capped at 1,000 customers, but included lifecycle-event histories are not bounded. The outer cap must not be mistaken for exhaustive processing of larger tenant audiences. |

The highest-confidence scale concern is unbounded list/aggregation work, not a demonstrated missing-index latency incident. Plan pagination or database aggregation where appropriate before adding indexes indiscriminately. Retain tenant predicates and tenant-leading index prefixes when changing queries. Recheck query plans with representative tenant sizes and write volume before accepting new indexes.

## Read-only EXPLAIN evidence

Used `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on SELECT-only SQL in a `READ ONLY` transaction with a 10-second per-statement timeout. Tenant/conversation IDs were selected internally and never printed. Only plan node types, relation/index names, aggregate row counts, timing and buffer counts were emitted; filter expressions and record contents were suppressed.

These SQL statements represent the primary predicates and ordering in the application queries, not a capture of every SQL statement Prisma emits for relation includes. The message-analytics plan isolates the tenant/time-range/order portion; it does not cover every relationship/OR filter. There was no data loading, `ANALYZE` statistics command, write query, forced-index setting or schema change.

| Representative query | Observed plan | Returned rows |
| --- | --- | ---: |
| Inbox with actual tenant/channel/non-null-customer predicates, no outer limit | Sequential scan, sort | 2 |
| Attention queue | Sequential scan, sort, limit | 1 |
| Conversation history | Sequential scan, sort, limit; 54 matching message rows before limit | 30 |
| Lead dashboard without status | Sequential scan, sort | 2 |
| Lead dashboard with NEW status | Sequential scan, sort | 1 |
| Due follow-ups | `follow_ups_status_scheduled_at_index` scan, incremental sort, limit | 0 |
| AI usage range | `ai_usage_records_business_model_occurred_index` scan | 0 |
| Message analytics tenant/range/order | Sequential scan, sort | 80 |
| Lifecycle overview | `customer_lifecycle_events_business_type_occurred_index` scan, sort, limit | 0 |
| Campaign conversion range | `campaign_recipients_business_campaign_status_index` scan | 0 |

The final successful observations showed zero shared block reads, with cached shared hits. Timings on these tiny, mostly empty tables are intentionally not presented as a performance benchmark or SLO evidence. Sequential scans over a few rows are a reasonable planner choice and do not demonstrate that existing indexes are ineffective. Empty-table index selection likewise does not prove useful production selectivity.

The initial campaign retry EXPLAIN failed because the observed database lacks the new column. That read-only transaction made no changes. The final complete source-database collection explicitly skipped this query after checking `information_schema`. Do not apply a migration to an existing environment merely to hide this audit finding.

Follow-up evidence at 16:36:35 UTC: the separately isolated recovery cluster was migrated, given clearly synthetic non-sendable fixtures, backed up and restored into another new database. The new columns/indexes and populated follow-up/campaign/recipient/lifecycle records survived, and the campaign retry SELECT EXPLAIN succeeded on that restored schema (Limit → Sort → Nested Loop with sequential scans). See [the populated postmigration drill](database-recovery.md#populated-postmigration-drill-2026-10-01). This closes schema/restore executability evidence; a one-row skipped recipient does not validate production-size pending retry-queue performance. The original source database remains unchanged by the audit/drill.

## Secret scan evidence and limits

Final scan covered **294 tracked or untracked, nonignored working-tree text files**, **810 reachable historical text blobs**, and **70 commits reachable from local refs**. Working-tree and historical scans found **zero matches** for either:

- High-confidence token formats: OpenAI/Anthropic-style keys, GitHub tokens, AWS access-key IDs, Slack tokens, Stripe live secret keys, and PEM/OpenSSH private-key headers.
- Exact currently configured local secret values read privately from `server/.env` for key/token/secret/password/database-URL fields, excluding short values and obvious placeholders. Those values were compared only in memory and were never printed or written to this report.

`git ls-files '*env*'` showed only `server/.env.example`, `dashboard/.env.example`, and the environment configuration source file. The real `.env`, `server/.env`, and `dashboard/.env` paths are ignored, and `git log --all -- <those paths>` returned no history. The scanner emitted only counts and, if a match had existed, filename/category/blob/commit metadata. No matching credential values, environment-file contents, connection URLs, or backup contents were exposed. No secret removal, rotation or Git-history rewrite was performed because this scan did not identify an exposed secret.

This is a bounded pattern/exact-value scan, not a guarantee that all secrets are absent. Binary blobs and text blobs larger than 2 MiB were skipped. Unreachable objects/reflogs, unfetched remote refs, external logs, build artifacts, deployment secret stores, and ignored runtime files were not scanned as repository content. Unknown token formats and historical secrets whose values differ from current local configuration can evade these patterns. No provider validation calls were made. Enable repository/CI secret scanning and provider push protection where available; investigate and rotate any future finding before considering history cleanup.
