# Sprint 15 verification and handoff

Work is on `feature/sprint-15-hardening`. Verification below was completed before the requested local commit. No push is included.

## Scope and outcomes

| Area | Repository outcome / evidence |
| --- | --- |
| Webhook trust | Exact-byte HMAC remains mandatory; empty secrets fail closed; streamed 1 MiB cap, bounded envelopes; malformed and duplicate-event regressions. |
| Tenant isolation | Authenticated membership or verified receiving phone ID supplies scope; exact-ID and nested relations remain tenant-bound. No default tenant. |
| Authorization | Typed OWNER/STAFF matrix and service-level configuration/campaign guards; built-in management APIs blocked, including encoded paths. |
| Input validation | Existing Zod boundaries retained; body, array, identifier and scheduled payload limits hardened. |
| Rate limits | Bounded single-process auth, dashboard, AI and campaign budgets; spoofed proxy headers cannot evade the auth bucket. Shared/distributed/edge quotas remain deployment work. |
| Secrets | Working-tree/history/exact configured-value scan found no matches; env ignored. Rotation instructions do not silently rotate live credentials. |
| Logs and traces | Central nested-field/secret redaction, safe child loggers and path families; AsyncLocalStorage correlation; per-span input/output/context removal before exporters. |
| Prompt injection | Actual installed Mastra tool-loop adversarial tests, deliberately hostile mock model; one live cross-tenant evaluation also passed. |
| AI side effects | Customer tools remain read-only; validated application logic owns metadata, lead capture, handoff, consent and sends. |
| Indexes | Actual SELECT-only EXPLAIN review; only due-retry index and lifecycle replay unique index added. Tiny data is not a scale benchmark. |
| Idempotency | Inbound external-ID uniqueness; atomic outbound attempt claim; monotonic status ledger/projection replay; lifecycle explicit-key replay; campaign prepare CAS. |
| Retries | Typed failure classification, maximum three definite attempts, persisted delay; ambiguous acceptance never automatically replayed. |
| Failure visibility | Existing durable failed rows, outbound auth block, stale-attempt alerts, count-only operator status CLI and recovery runbook. |
| LLM outage | Saved inbound remains; HUMAN escalation with control-version checks; no undefined, JSON envelope, exception dump or fabricated fallback reply. |
| Meta failures | Graph numeric code classification in addition to HTTP; auth circuit preserves inbound resolution. Official code reference retrieval returned 429; live documentation review remains a gate. |
| Correlation | Request, tenant/message, workflow and agent/conversation metadata survive without transcript logging. |
| Mastra | Installed-version processor/logger interfaces used; private processor applies to child spans too. Management Studio APIs no longer bypass business authorization. |
| Alerts | Aggregated operational.alert log hook plus ops:status. No external destination/collector is configured or claimed verified. |
| Backups | Protected custom-format pg_dump with consistent snapshot, manifest/checksum and scoped retention; production daily scheduling/off-host encrypted storage documented, not configured. |
| Restore | Original real snapshot and populated postmigration synthetic snapshot restored into separate fresh DBs; schema/count/Prisma checks passed; scratch cluster stopped. |

## Migration

`20261001090000_transport_attempt_guards` adds:

- WhatsAppMessage.sendStartedAt; existing pending outbound rows conservatively claimed.
- WhatsAppConnection.outboundBlockedAt, without disabling inbound.
- CampaignRecipient.nextAttemptAt plus status/time index.
- CustomerLifecycleEvent.requestKey plus tenant-scoped uniqueness.

No old applied migration was edited and no development database reset was performed.

Applied successfully to the development database after the isolated suite passed and a fresh protected backup was created at `/tmp/wa-sprint15-precommit-backups-20261001/wa-backup-1790874716598-2141190f-2416-4f16-b10d-bbc06cf2971b.dump`. Migration status confirms all 18 migrations are applied. This local archive is not an off-host production backup.

## Verification commands and results

- `npm exec --prefix server -- prisma format --schema server/prisma/schema.prisma`: passed.
- `npm run db:validate --prefix server`: passed.
- `npm run db:generate --prefix server`: passed.
- `npm run typecheck --prefix server`: passed.
- `npm run typecheck --prefix dashboard`: passed.
- `npm run lint --prefix dashboard`: passed.
- `npm run build --prefix dashboard`: passed.
- `npm test --prefix server`: **444 tests passed across 53 files**, including isolated database/HTTP integration, authorization, tenant isolation, AI security, retries, idempotency, analytics and recovery safety. Final run completed in 195.63 seconds. The test servers now use isolated workflow storage and fake provider credentials; the startup deadline was not increased.
- Targeted auth/lead HTTP/privacy rerun: 40 tests passed.
- Actual-Mastra adversarial/runtime checks: 68 focused tests passed.
- `npm run test:ai:dataset:live --prefix server -- cross-tenant-car-to-salon`: 1/1 passed with generation enabled and tenant-bound tools. Synthetic tenant usage recording produced an expected foreign-key warning; no real business data or WhatsApp send was used.
- `npm run build --prefix server`: passed, including generated deployment dependency installation.
- `npm run start --prefix server`: production smoke passed with an isolated test database, in-memory workflow/trace stores and synthetic provider credentials. Health/readiness/version returned 200; unauthenticated account access returned 401; normal and encoded management API paths returned 403; session lookup returned 200. Webhook verification returned 200, unsigned POST returned 401, and a signed empty synthetic event returned 200. No external messages were sent; the owned smoke server was stopped.
- `npm run db:migrate --prefix server`, `npm run db:status --prefix server`, `npm run db:connect --prefix server`: passed against development without reset, after backup.
- `npm run ops:status --prefix server`: correctly exited 1 with `attentionRequired=true` for two pre-existing RECEIVED inbound records from September 18, both without a canonical conversation message. No blocked connections, stale outbound sends or recent failed inbound/follow-up/campaign records were reported. Read-only inspection confirmed their original timestamps; no replay, deletion or artificial completion was performed.
- Backup/restore: two actual isolated drills passed; see the recovery evidence.
- `git diff --check`: passed. Real env paths are ignored. A fresh scan of all 72 changed files against configured secret values and high-confidence credential patterns found no matches.

There is no server formatter/linter script configured; no extra formatting framework was installed.
No browser/a11y/Lighthouse/visual scan or real Meta send was run for this sprint.

## Remaining production gates and known limitations

1. Configure an external alert receiver/log rule and heartbeat monitoring, then prove delivery.
2. Provision encrypted off-host backup storage, activate daily schedule/30-day retention, monitor failures and test restoration there. Local private /tmp archives are not production backups.
3. Verify the production proxy/firewall/TLS setup; add edge auth abuse protection and shared limits before multiple replicas.
4. Verify the current official Meta error-code list; automated fixtures are not live Meta rejection tests.
5. A crash before canonical inbound text persists still depends on Meta replay. Stale claims are visible and reclaimable from signed replay, not a durable ingress queue.
6. Ambiguous external sends require reconciliation, never automatic blind replay. Outbound auth blocks require operator rotation/resume.
7. Large inbox/lead/customer lists and in-memory analytics aggregation remain scale risks. Existing tiny local tables do not justify speculative index changes.
8. Confirm host permissions/retention for logs, trace stores, secret files and backups; application code alone cannot prove infrastructure controls.
9. Reconcile the two historical September 18 inbound records with retained Meta delivery evidence. They cannot safely be regenerated from the ledger alone; the operational check intentionally remains nonzero until addressed.

## Manual checks

Start `npm run dev`, sign in, and select the intended business. Verify owner configuration edits work; a STAFF session receives 403 for configuration/campaign mutations but can use operational inbox/lead actions. Open the tenant-authorized playground (not direct Studio), continue a conversation, and inspect normal dashboard analytics. Repeat a customer outcome submission after a failed response: the same request key must not duplicate the outcome. Review failed transport/campaign/follow-up states and the runbook before attempting recovery.

## Files changed

- `dashboard/src/api/client.ts`
- `dashboard/src/pages/CustomersPage.tsx`
- `docs/README.md`
- `docs/ai/action-boundaries.md`
- `docs/engineering/authorization.md`
- `docs/engineering/database-recovery.md`
- `docs/engineering/operations-runbook.md`
- `docs/engineering/sprint-15-audit.md`
- `docs/engineering/sprint-15-verification.md`
- `server/.env.example`
- `server/package.json`
- `server/prisma/migrations/20261001090000_transport_attempt_guards/migration.sql`
- `server/prisma/schema.prisma`
- `server/scripts/connect-whatsapp-number.ts`
- `server/scripts/database-backup.ts`
- `server/scripts/operations-status.ts`
- `server/src/ai/agent-result.ts`
- `server/src/ai/customer-service-agent.ts`
- `server/src/auth/auth.ts`
- `server/src/auth/mastra-auth.ts`
- `server/src/business-configuration/tenant-business-profile.service.ts`
- `server/src/business-configuration/tenant-business-rule.service.ts`
- `server/src/business-configuration/tenant-opening-hours.service.ts`
- `server/src/business-data/business-type-templates.ts`
- `server/src/business-data/tenant-business-catalog.service.ts`
- `server/src/business-data/tenant-business-schema.service.ts`
- `server/src/channels/ai-playground-channel.ts`
- `server/src/channels/dashboard-agent-channel.ts`
- `server/src/follow-ups/follow-up-worker.ts`
- `server/src/follow-ups/follow-up.service.ts`
- `server/src/http/bounded-body.ts`
- `server/src/http/errors.ts`
- `server/src/http/follow-up-routes.ts`
- `server/src/http/lead-dashboard-routes.ts`
- `server/src/http/logger.ts`
- `server/src/http/middleware.ts`
- `server/src/http/rate-limit.ts`
- `server/src/http/reactivation-routes.ts`
- `server/src/http/security-middleware.ts`
- `server/src/http/whatsapp-webhook-routes.ts`
- `server/src/mastra/index.ts`
- `server/src/mastra/workflows/campaign-workflow.ts`
- `server/src/mastra/workflows/follow-up-workflow.ts`
- `server/src/observability/correlation.ts`
- `server/src/observability/operational-alerts.ts`
- `server/src/observability/private-traces.ts`
- `server/src/observability/redaction.ts`
- `server/src/reactivation/campaign-worker.ts`
- `server/src/reactivation/campaign.service.ts`
- `server/src/reactivation/customer-lifecycle.service.ts`
- `server/src/tenancy/business-permissions.ts`
- `server/src/tenancy/dashboard-tenant-context.ts`
- `server/src/whatsapp/meta-whatsapp-transport.ts`
- `server/src/whatsapp/normalize-inbound-message.ts`
- `server/src/whatsapp/process-inbound-webhook.ts`
- `server/src/whatsapp/retry-policy.ts`
- `server/src/whatsapp/webhook-signature.ts`
- `server/src/whatsapp/whatsapp-connection.repository.ts`
- `server/src/whatsapp/whatsapp-message.repository.ts`
- `server/src/whatsapp/whatsapp-send.service.ts`
- `server/src/whatsapp/whatsapp-send.types.ts`
- `server/tests/ai-security.test.ts`
- `server/tests/auth.integration.test.ts`
- `server/tests/business-permissions.test.ts`
- `server/tests/customer-reactivation.integration.test.ts`
- `server/tests/dashboard-agent-channel.integration.test.ts`
- `server/tests/database-backup.test.ts`
- `server/tests/helpers/mastra-server.ts`
- `server/tests/security-hardening.test.ts`
- `server/tests/whatsapp-agent-channel.test.ts`
- `server/tests/whatsapp-message-tracking.integration.test.ts`
- `server/tests/whatsapp-send-message.test.ts`

## Supporting documents

- [Authorization matrix](authorization.md)
- [Operational procedures, limits, retry and rotation](operations-runbook.md)
- [Backup/restore evidence](database-recovery.md)
- [Index and secret scan evidence](sprint-15-audit.md)
- [AI action boundaries](../ai/action-boundaries.md)
