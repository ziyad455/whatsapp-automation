import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const archivePattern = /^wa-backup-\d{13}-[a-f0-9-]{36}\.dump$/;
const tables = ['businesses', 'customers', 'conversations', 'conversation_messages', 'leads', 'follow_ups', 'campaigns', 'customer_lifecycle_events', '_prisma_migrations'] as const;
type Counts = Record<string, string>;
type Manifest = { version: 1; createdAt: string; sha256: string; counts: Counts };

export function connectionEnvironment(value: string, passwordFile: string): { env: NodeJS.ProcessEnv; password: string } {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('A valid PostgreSQL connection URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname === '/') {
    throw new Error('A PostgreSQL URL with host, user and database is required.');
  }
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, LANG: 'C', PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGPASSFILE: passwordFile,
    PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'whatsapp-database-recovery',
  };
  const supported: Record<string, string> = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY' };
  for (const [key, value] of url.searchParams) {
    if (key === 'schema' && value === 'public') continue;
    if (!supported[key]) throw new Error('Unsupported connection URL parameter; use a direct PostgreSQL recovery connection.');
    env[supported[key]] = value;
  }
  const fields = [env.PGHOST!, env.PGPORT!, '*', env.PGUSER!, decodeURIComponent(url.password)];
  if (fields.some(field => /[\r\n\0]/.test(field))) throw new Error('Invalid connection credential characters.');
  const password = fields.map(field => field.replace(/\\/g, '\\\\').replace(/:/g, '\\:')).join(':') + '\n';
  return { env, password };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, input?: string): Promise<void> {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { env, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => reject(new Error(`${command} could not start.`)));
    child.on('exit', code => code === 0 ? accept() : reject(new Error(`${command} failed (exit ${code ?? 'signal'}); inspect server-side logs securely.`)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function withConnection<T>(url: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'wa-pgpass-'));
  try {
    const { env, password } = connectionEnvironment(url, join(directory, 'pgpass'));
    await writeFile(env.PGPASSFILE!, password, { mode: 0o600, flag: 'wx' });
    return await fn(env);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function checksum(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

type Reader = { $queryRawUnsafe<T>(query: string): Promise<T> };
async function counts(client: Reader): Promise<Counts> {
  const result: Counts = {};
  for (const table of tables) {
    const [row] = await client.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) AS count FROM public."${table}"`);
    result[table] = row.count.toString();
  }
  const [schema] = await client.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) AS count FROM information_schema.columns WHERE table_schema = 'public'");
  result.public_columns = schema.count.toString();
  const [constraints] = await client.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) AS count FROM pg_constraint WHERE connamespace = 'public'::regnamespace");
  result.public_constraints = constraints.count.toString();
  return result;
}

const clientFor = (url: string) => new PrismaClient({ adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 10_000 }) });

export async function backup(databaseUrl: string, directory: string, retentionDays = 30): Promise<string> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error('Retention must be a positive number of days.');
  directory = resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || (directoryStat.mode & 0o077) !== 0) throw new Error('Backup directory must be a real directory with mode 0700.');
  const file = join(directory, `wa-backup-${Date.now()}-${randomUUID()}.dump`);
  const partial = `${file}.partial`;
  const client = clientFor(databaseUrl);
  try {
    await writeFile(partial, '', { flag: 'wx', mode: 0o600 });
    const snapshotCounts = await withConnection(databaseUrl, env => client.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const [snapshot] = await tx.$queryRawUnsafe<{ snapshot: string }[]>('SELECT pg_export_snapshot() AS snapshot');
      const snapshotCounts = await counts(tx);
      await run('pg_dump', ['--no-password', '--format=custom', '--compress=6', '--no-owner', '--no-acl', `--snapshot=${snapshot.snapshot}`, `--file=${partial}`], env);
      return snapshotCounts;
    }, { isolationLevel: 'RepeatableRead', timeout: 3_600_000, maxWait: 10_000 }));
    await withConnection(databaseUrl, env => run('pg_restore', ['--list', partial], env));
    const manifest: Manifest = { version: 1, createdAt: new Date().toISOString(), sha256: await checksum(partial), counts: snapshotCounts };
    await writeFile(`${file}.json.partial`, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(partial, file);
    await rename(`${file}.json.partial`, `${file}.json`);
    const cutoff = Date.now() - retentionDays * 86_400_000;
    for (const name of await readdir(directory)) {
      if (!archivePattern.test(name) || Number(name.split('-')[2]) >= cutoff) continue;
      const candidate = join(directory, name);
      const stat = await lstat(candidate);
      if (!stat.isFile()) continue;
      await rm(candidate);
      await rm(`${candidate}.json`, { force: true });
    }
    return file;
  } finally {
    await client.$disconnect();
    await rm(partial, { force: true });
    await rm(`${file}.json.partial`, { force: true });
  }
}

export async function restore(adminUrl: string, archive: string): Promise<{ database: string; counts: Counts }> {
  archive = resolve(archive);
  if (!archivePattern.test(basename(archive))) throw new Error('Use an archive produced by db:backup.');
  const stat = await lstat(archive);
  if (!stat.isFile()) throw new Error('Archive must be a regular file.');
  const manifest = JSON.parse(await readFile(`${archive}.json`, 'utf8')) as Manifest;
  if (manifest.version !== 1 || manifest.sha256 !== await checksum(archive)) throw new Error('Backup manifest or checksum mismatch.');
  const database = `wa_restore_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await withConnection(adminUrl, async env => {
    await run('pg_restore', ['--list', archive], env);
    await run('psql', ['--no-password', '--no-psqlrc', '--set=ON_ERROR_STOP=1'], env, `CREATE DATABASE "${database}" TEMPLATE template0;\nREVOKE CONNECT ON DATABASE "${database}" FROM PUBLIC;\n`);
    console.log(JSON.stringify({ event: 'restore_database_created', database }));
    await run('pg_restore', ['--no-password', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '--dbname', database, archive], { ...env, PGDATABASE: database });
  });
  const restoredUrl = new URL(adminUrl);
  restoredUrl.pathname = `/${database}`;
  const client = clientFor(restoredUrl.toString());
  try {
    const restoredCounts = await counts(client);
    if (JSON.stringify(restoredCounts) !== JSON.stringify(manifest.counts)) throw new Error('Restored row/schema counts differ from the backup snapshot.');
    await client.business.findFirst({ select: { id: true } });
    await client.customer.findFirst({ select: { id: true } });
    await client.conversation.findFirst({ select: { id: true } });
    await client.lead.findFirst({ select: { id: true } });
    await client.followUp.findFirst({ select: { id: true } });
    await client.campaign.findFirst({ select: { id: true } });
    return { database, counts: restoredCounts };
  } finally { await client.$disconnect(); }
}

async function main(): Promise<void> {
  process.umask(0o077);
  const [command, archive] = process.argv.slice(2);
  if (command === 'backup' && process.env.DATABASE_URL && process.env.BACKUP_DIR) {
    const file = await backup(process.env.DATABASE_URL, process.env.BACKUP_DIR, Number(process.env.BACKUP_RETENTION_DAYS ?? 30));
    console.log(JSON.stringify({ event: 'backup_succeeded', archive: file, createdAt: new Date().toISOString() }));
  } else if (command === 'restore' && archive && process.env.RESTORE_ADMIN_URL) {
    const result = await restore(process.env.RESTORE_ADMIN_URL, archive);
    console.log(JSON.stringify({ event: 'restore_verified', ...result }));
  } else throw new Error('Use backup with DATABASE_URL/BACKUP_DIR, or restore <archive> with RESTORE_ADMIN_URL.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // Database/tool errors may contain connection strings or restored customer data.
    console.error(JSON.stringify({ event: 'database_recovery_failed', message: 'Operation failed; verify credentials, tools, permissions, archive and database server logs securely.' }));
    process.exitCode = 1;
  });
}
