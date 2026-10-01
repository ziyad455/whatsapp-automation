# Operations and recovery

This application currently runs as one Node/Mastra process backed by PostgreSQL.
No production hosting provider, remote alert destination or backup mount is configured
in this repository. The instructions below separate repository behavior from deployment work.

## HTTP and authorization

- Only application adapters are exposed. The built-in `/api/*` management surface
  (agents, tools, workflows, storage, traces) is denied, including encoded-path variants.
  Business membership is not permission to administer the shared Mastra runtime.
  Use the tenant-authorized dashboard playground for AI debugging, not Studio's direct APIs.
- The [OWNER/STAFF matrix](authorization.md) is enforced in configuration services.
- JSON and webhook bodies are limited to 1 MiB by counted stream bytes, not just
  Content-Length. Webhook verification still covers the exact bytes before JSON parsing.
  Meta arrays and identifiers also have bounds. Unsupported message types are ignored;
  malformed message/status envelopes are rejected before customer or message writes.
- Auth uses a process-wide budget of 120 requests/minute and 20 email sign-in
  attempts/minute. Forwarded-IP headers do not select a bucket. Dashboard calls are
  limited to 180/minute/authenticated user, AI chat/playground to 12/minute/user,
  and campaign launches to 5/minute/user. Rejections return 429 with Retry-After.
  These bounded in-memory counters reset on restart; they are not distributed quotas.
  The shared auth bucket can be exhausted by an attacker: deploy an edge auth limit
  with a verified client-IP source before public rollout. For multiple replicas,
  replace the counters with shared storage or enforce equivalent ingress quotas.
- Browser mutations with an Origin must match the configured dashboard/server origin.
  Secure cookies and SameSite remain Better Auth's responsibility. A missing Origin
  does not replace session/membership checks. Private responses use no-store.
- Webhooks are not throttled by the auth/dashboard limiter; legitimate Meta bursts
  are protected by signatures, payload limits and database idempotency.

## Webhook or AI incident

1. Check `/health` for process liveness and `/ready` for database access. Inspect
   correlated requestId/businessId/messageId events, not customer payloads.
2. A 401 webhook response means signature rejection. Verify the app secret and exact
   bytes/proxy handling. Never disable HMAC to clear the incident. Unknown receiving
   phone IDs must be provisioned through `WhatsAppConnection`; never use a default tenant.
3. Inspect `whatsapp_messages.processing_status` and the canonical conversation.
   The external Meta message ID is unique. Replaying a signed event cannot create a
   second inbound ledger row. A stale pre-conversation claim can be reclaimed on a
   signed replay after 15 minutes; the subsequent processing transition is atomic.
4. Once conversation history exists, failed AI/send processing is not automatically
   replayed. The inbound history remains, and the WhatsApp conversation is escalated
   to HUMAN with its control-version guard. Staff can respond through the inbox.
   Missing/invalid model replies and provider exceptions do not produce a fallback
   fabricated answer. See [AI action boundaries](../ai/action-boundaries.md).
5. A process dying between ledger insertion and canonical history insertion may leave
   a stale claim without message text. It requires Meta replay; the ledger is not a
   durable raw-payload queue. `ops:status` flags this rather than pretending recovery
   can reconstruct a message that was never stored. A durable ingress queue remains
   a future reliability enhancement if the deployment requires that guarantee.

## Meta errors and duplicate-send prevention

An outgoing reservation has an atomic `sendStartedAt` claim. Only one caller can send
that reservation. The migration conservatively marks pre-existing PENDING rows claimed;
they must be reconciled, not replayed. Canonical conversation-message uniqueness prevents
two reservations for one known operation. Operator sends without a canonical message ID
are distinct operations and must not be retried as though they shared an idempotency key.

| Classification | Behavior |
| --- | --- |
| Auth/configuration | No automatic retry; AUTHENTICATION persistently blocks outbound on that connection and emits an immediate alert signal. Inbound resolution remains active. |
| Rate limit | Known Graph throttling codes or HTTP 429; honor bounded Retry-After, maximum 3 attempts. |
| Transient | Recognized provider rejection codes 1, 2, 131000, 131016; maximum 3 attempts. |
| Permanent | Invalid recipient, template, request, policy/quality or unrecognized 4xx; visible failure, no blind retry. |
| Ambiguous | Timeout, network failure, malformed success, unknown/gateway 5xx, or failure persisting acceptance; no automatic replay. Meta may already have accepted it. |

The centralized retry policy uses persisted 2-minute then 4-minute delays (or a longer
Retry-After, capped at 24 hours). Campaign `nextAttemptAt` and follow-up `scheduledAt`
gate polling; there are no timer-only durable retries. A definite rejection may rearm
the same transport reservation. No timeout resets its send claim. Stale SENDING work
becomes FAILED/INDETERMINATE and requires reconciliation. A separate dispatcher cannot
mark another worker's active campaign send failed.

Meta status transitions are monotonic and recipient/tenant-bound. Campaign delivery
projections read the canonical ledger and reconcile on replay, so a crash between the
two writes can be repaired without regressing READ to FAILED. Lifecycle replay uses
an explicit tenant-scoped request UUID, not similarity matching of business facts.

Reference: [Meta error codes](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/).
The official page returned HTTP 429 during this audit; current documentation could
not be retrieved here. Known-code behavior is covered by fixtures, but verify the
code list against Meta's live reference before production rollout. Unknown codes fail
conservatively rather than being guessed retryable.

## Failed operation recovery

Run `npm run ops:status --prefix server` using the target environment's secret file.
This operator-only command emits counts and exits nonzero for blocked credentials,
stale transport/inbound attempts, or at least five recent failures. It emits no phone
numbers, message text or tokens. Schedule it every five minutes in the deployment's
monitor runner and alert on a nonzero exit or missed heartbeat.

For failed FollowUps/CampaignRecipients, inspect reason, attempt count and linked
transport in PostgreSQL and dashboard analytics/campaign detail. Do not delete failed
rows to make counters green. Do not blanket-update FAILED to PENDING.

- Rate/provider rejection: existing bounded retry handles it. Exhausted attempts stay
  failed; staff must recheck consent, timing, conversation mode, template and business state.
- Permanent recipient/template rejection: correct the underlying condition and create
  a separately reviewed operation. Cancellation is preferable to blind replay.
- Ambiguous/SENDING/PENDING after a crash: reconcile provider delivery evidence first.
  If acceptance cannot be disproved, do not resend automatically. Staff may explicitly
  choose a new customer communication after reviewing the conversation.
- Invalid token: rotate the token, restart safely, verify its provider permissions, then
  run `npm run whatsapp:connect --prefix server -- --business-id=<UUID> --resume-outbound`
  with the intended receiving number/WABA in env. This clears the connection block only;
  it does not retry failed sends. The script refuses to reassign another tenant's number.
- Database unavailable: stop outgoing automation until readiness recovers. Never infer
  that an unrecorded provider acceptance failed. Follow the restore procedure below
  if state cannot be recovered.

## Logs, traces and alerts

AsyncLocalStorage carries request correlation without global tenant state. Workflows
add workflowRunId; agent spans add business/conversation/operation metadata. Logs use
identifiers and controlled error names. Central redaction strips nested credentials,
headers, raw provider requests/responses, customer fields and Error bodies, and replaces
configured secrets in log text. Child loggers use the same boundary.

Installed Mastra span processors run before storage/platform export. Every agent,
model, tool and workflow span drops input/output/requestContext and uses a metadata
allowlist; error stacks and bodies are suppressed. This intentionally prevents replaying
private transcripts from traces. Business history remains in the authorized database,
not the observability store. Apply access controls and retention to that database,
LibSQL/DuckDB trace stores and host logs; repo code alone cannot enforce host permissions.

`operational.alert` is an aggregation hook in JSON logs, **not a configured external
notification service**. Immediate signals: Meta auth, DB outage, stale attempts.
Thresholds per five-minute window: 20 signature failures or 5 AI/webhook/send/workflow
failures, with one alert per kind/business/window. Deployment must connect its existing
log collector to those events, route to the on-call destination, and prove delivery
with a synthetic event. Monitor missing process/backup heartbeats outside the process.
Do not claim alerts work merely because a JSON event appeared locally.

## Secrets and restoration

Secrets belong only in untracked environment files or the deployment secret store.
Use restrictive permissions. Never put server variables behind VITE_ or render them
into the dashboard. The [secret/index audit](sprint-15-audit.md) records scan scope.
Keys pasted into chat or other non-secret systems should be rotated independently of
whether Git scanning finds them; this task does not silently revoke live credentials.

Rotate AI/Meta tokens: provision new credential → update secret file/store → restart
and check readiness → perform a controlled provider check → revoke old credential.
Rotate Meta app/verification secrets in coordination with webhook configuration; expect
in-flight old signatures to fail rather than accepting both indefinitely. Rotate
Better Auth signing secrets during a planned session invalidation window. Rotate DB
passwords through a new least-privilege credential, switch/restart, verify readiness,
then revoke old access. Do not log old/new values while diagnosing rotation.

See [database recovery](database-recovery.md) for the actual tested pg_dump/restore,
daily scheduling, 30-day retention, off-host encryption and remaining deployment gates.
