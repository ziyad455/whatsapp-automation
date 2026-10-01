# Database backup and recovery

## Implemented and operational boundaries

`server/scripts/database-backup.ts` makes a compressed PostgreSQL custom-format archive and a SHA-256 manifest. The manifest records representative row counts, migration count, public column count and constraint count from the **same exported, read-only repeatable-read snapshot** used by `pg_dump`. Restore verifies the digest, creates a random `wa_restore_<time>_<random>` database, restores in one transaction, compares those counts and performs reads through the generated Prisma client.

The tool never accepts an existing restore target, drops a database, or uses `--clean`. It revokes public connection access on the new database and retains it on success or failure for investigation. It does not start the application, schedulers, messaging workers or outbound integrations against restored data.

No provider backup service, remote storage, encryption service, recurring scheduler or external alert destination has been configured by this repository change. The verified local archive is a recovery exercise, **not production disaster recovery**. Provision the deployment controls below before treating backups as operational. A database dump excludes cluster roles, provider configuration, credentials and external assets; recover those from separately protected configuration/secrets storage.

## Policy and deployment setup

| Control | Required deployment configuration |
| --- | --- |
| Frequency / target RPO | Daily at 02:15 UTC; up to 24 hours of data loss. Use provider PITR/WAL archiving if this is unacceptable. |
| Retention | 30 days (`BACKUP_RETENTION_DAYS=30`), plus provider/object versioning or immutable retention to survive account compromise. |
| Storage | One private `BACKUP_DIR` per environment on a separately provisioned storage host/volume outside the DB host's failure domain. A second directory on the DB disk does not qualify. |
| Encryption | TLS with certificate verification for remote PostgreSQL and encrypted storage/transport for the backup mount; manage keys separately. Custom-format compression is not encryption. |
| Access | Dedicated service account, directory mode 0700, files 0600, least-privilege backup role with SELECT on required tables, no credentials in Git or command arguments. |
| Monitoring | Collect `backup_succeeded`/`database_recovery_failed` JSON and process exit code. Alert on nonzero exit immediately and no successful archive within 26 hours. Independently check archive freshness at the remote destination. |
| Recovery exercises | Monthly and after schema or PostgreSQL version changes; retain a report with timestamps and elapsed recovery time. Set an RTO from measured production-size exercises; this small local drill does not establish production RTO. |

Install PostgreSQL client binaries compatible with the server major version (`pg_dump`, `pg_restore`, `psql`) and application dependencies/generated Prisma client. Use a direct PostgreSQL URL, not a transaction-pooler endpoint, so the exported snapshot remains usable. URLs support `schema=public`, `sslmode`, `sslrootcert`, `sslcert`, `sslkey`; unsupported URL parameters fail closed. Configure verified TLS appropriate to the hosting provider rather than weakening TLS to make the script run.

Inject `DATABASE_URL` from the deployment secret store or a mode-0600 environment file. The subprocess receives a short-lived mode-0600 password file inside a mode-0700 temporary directory; raw tool errors are suppressed because they can contain sensitive rows. The application process still holds credentials in memory. Restrict OS access, never enable shell tracing, and inspect database logs only through authorized diagnostics. Abrupt process termination may leave the temporary `wa-pgpass-*` directory; apply private-temp cleanup appropriate to the service account.

From `server/`, after provisioning the protected destination:

```sh
BACKUP_DIR=/mnt/whatsapp-backups/production npm run db:backup
```

`db:backup` loads the existing `.env`; externally injected environment values take precedence. It only prunes regular archives matching its own timestamp/UUID naming scheme, older than the configured retention, in that directory, after a new archive and manifest are complete. Never share a directory between environments. Copies must include both `.dump` and `.dump.json`. Checksums detect corruption, not malicious replacement; only restore trusted archives under operator control because PostgreSQL restores execute SQL from the archive.

For a VM deployment, install a service and timer using these settings, substituting the actual deployed path/account. These are templates, **not installed units**:

```ini
# whatsapp-db-backup.service
[Unit]
Description=WhatsApp PostgreSQL backup
RequiresMountsFor=/mnt/whatsapp-backups
[Service]
Type=oneshot
User=whatsapp-backup
WorkingDirectory=/opt/whatsapp-automation/server
EnvironmentFile=/etc/whatsapp-automation/backup.env
Environment=BACKUP_DIR=/mnt/whatsapp-backups/production
Environment=BACKUP_RETENTION_DAYS=30
UMask=0077
ExecStartPre=/usr/bin/mountpoint -q /mnt/whatsapp-backups
ExecStart=/usr/bin/node --import tsx scripts/database-backup.ts backup
TimeoutStartSec=2h

# whatsapp-db-backup.timer
[Unit]
Description=Daily WhatsApp PostgreSQL backup
[Timer]
OnCalendar=*-*-* 02:15:00 UTC
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
```

Provision and verify the remote encrypted mount first; `mountpoint` prevents silently writing to local disk if it is unavailable. Enable the timer only after a manual successful backup and drill. Attach service failure and freshness alerts to the team's real external monitoring destination. For managed/container hosting, configure the platform's scheduled job with equivalent secret injection, remote durable storage and alert checks instead. No alert transport is implied by the JSON output.

## Restore and validate

1. Select a trusted archive plus its manifest. Provision an isolated PostgreSQL instance with outbound application jobs disabled. Inject its administrative connection as `RESTORE_ADMIN_URL` with permission to create databases. Do not change the running application's `DATABASE_URL`.
2. From `server/`, run `npm run db:restore:drill -- /protected/path/wa-backup-<timestamp>-<uuid>.dump`. The script creates its own new database even if the admin URL points at an existing maintenance database. Record the `restore_database_created` event; a failure intentionally leaves the newly created DB for investigation.
3. Require `restore_verified` and exit zero. It compares snapshot row/schema counts and performs Prisma reads of businesses, customers, conversations, leads, follow-ups and campaigns, selecting IDs without printing them. Zero counts are legitimate and do not prove recovery of populated data for that model. Inspect expected recent records through authorized application tooling when validating production recovery; never paste their contents into logs or tickets.
4. Check migration versions against the application release you will restore. Counts alone do not prove full schema equivalence. For actual cutover, provision required database roles/grants and use the matching application release; this drill deliberately skips source ownership/ACLs. Reconnect an isolated application instance with background jobs disabled, authenticate and inspect representative tenant data before any production cutover.
5. During a real incident, freeze writers, take a backup of the old state if possible, obtain incident-owner authorization for cutover, update the application's secret to the verified replacement DB, restart, check readiness and tenant access, then resume workers deliberately. This script performs neither cutover nor rollback automatically. Keep the old database until the incident owner approves cleanup.
6. Remove the exact scratch database/cluster and sensitive archive when no longer needed, through an approved operator cleanup. Never run a broad drop or delete command against shared test/dev/production storage.

## Proven local drill: 2026-10-01

- Backup: `/tmp/wa-sprint15-backups-20261001/wa-backup-1790870702133-cbcc0d06-1f84-4695-a371-b521f35f4533.dump`, completed at 16:05:02 UTC. Manifest sits alongside it; both are private local temporary files.
- The configured source role lacked CREATEDB, so the first creation attempt correctly failed. No existing source or shared test database was overwritten. A separate PostgreSQL 18 cluster was initialized under `/tmp/wa-sprint15-restore-XlX60z` with a random password and private files, listening on loopback on an allocated free port.
- The same exported `restore()` used by the CLI restored into `wa_restore_1790870796008_430a26f7d4c0` and verified at 16:06:36 UTC. The temporary cluster was stopped after verification. Private `report.json` and cluster data remain in that directory; credentials were never printed or passed in process arguments.
- Snapshot and restored counts matched: businesses 1; customers 2; conversations 3; conversation messages 80; leads 2; follow-ups 0; campaigns 0; lifecycle events 0; Prisma migrations 17; public columns 319; public constraints 314.
- Six generated-Prisma model reads passed without exposing row contents. Follow-ups, campaigns and lifecycle events were empty in the source, so populated recovery for those models remains unproven in this drill. No workers, LLM calls or WhatsApp sends ran.
- Focused safety tests: `node --env-file=.env node_modules/vitest/vitest.mjs run tests/database-backup.test.ts` — 5 passed. No full suite or browser validation was needed for this change.
- Remaining production work: configure encrypted storage in a separate failure domain, install the daily schedule, connect external failure/freshness alert delivery, perform a production-size drill and agree on measured RTO. `/tmp` is neither durable retention nor off-host protection.

## Populated postmigration drill: 2026-10-01

This second exercise closes the empty-domain coverage gap above using **synthetic fixtures only**. It does not imply that real development data contained follow-ups, campaigns or lifecycle events, and does not change the first archive's baseline evidence.

- Restarted only the private scratch cluster `/tmp/wa-sprint15-restore-XlX60z` on an allocated loopback port. On its previously restored `wa_restore_1790870796008_430a26f7d4c0` database, ran `prisma migrate deploy` with an in-memory connection URL injected into the subprocess environment. The development and shared regression-test databases were not migrated or written by this exercise.
- Applied `20261001090000_transport_attempt_guards`, then inserted a separate clearly labeled synthetic business/customer/conversation/lead and exactly one follow-up, campaign, campaign recipient and lifecycle event through Prisma. The synthetic business and WhatsApp connection are inactive, outbound is blocked, the conversation is closed, the follow-up is cancelled, the campaign is draft and the recipient is skipped. No application server, worker, external API or send operation ran. Fixture insertion was transactional and respected existing category and channel-identity constraints.
- Used the same `backup()` implementation and exported snapshot to create `/tmp/wa-sprint15-populated-backups-20261001/wa-backup-1790872594722-47f63ffe-7758-437b-a650-96c58d4c5885.dump`, with its adjacent private checksum/count manifest.
- Used the same `restore()` implementation to create another fresh database, `wa_restore_1790872595126_777565a54f2c`. Verification completed at **16:36:35 UTC**. Neither scratch database overwrote another database.
- Snapshot/restored totals matched: businesses 2; customers 3; conversations 4; conversation messages 80; leads 3; follow-ups 1; campaigns 1; lifecycle events 1; Prisma migrations 18; public columns 323; public constraints 315. The drill separately compared total campaign-recipient counts, which were 1 in both databases, in addition to the standard manifest checks.
- Prisma reads confirmed exactly one fixture in each of the four formerly empty domains, preserved follow-up/lead tenant association, campaign/recipient association, recipient/lifecycle conversion association, lifecycle request UUID, retry timestamp and non-sendable statuses. The standard six-model read smoke also passed.
- Confirmed the new migration's completed record, all four added columns (`send_started_at`, `outbound_blocked_at`, `next_attempt_at`, `request_key`) and both new indexes survived restore. The campaign due-query EXPLAIN now executed successfully on this isolated migrated schema; it chose Limit → Sort → Nested Loop with sequential scans. A single skipped fixture is not a queue performance benchmark.
- Stopped the scratch cluster after verification. The source scratch DB, second restored DB, mode-0600 `populated-recovery-report.json`, protected credentials and diagnostic files remain inside the mode-0700 cluster directory. Both archives remain local/private; none is an off-host production backup. Operator cleanup is still required when these sensitive artifacts are no longer needed.

The one-off runner was `/tmp/wa-sprint15-populated-recovery.ts`, invoked from `server/` using `node --import tsx /tmp/wa-sprint15-populated-recovery.ts`. It contains no credentials and targets only the named scratch cluster; it is local drill evidence rather than a deployment command. Future exercises should follow the restore procedure above with fresh isolated infrastructure.

Reference: PostgreSQL [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html) and [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html) documentation.
