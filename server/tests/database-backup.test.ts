import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backup, connectionEnvironment, restore } from '../scripts/database-backup';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('database backup safety', () => {
  it('keeps passwords out of subprocess environment and preserves TLS', () => {
    const result = connectionEnvironment('postgresql://operator:a%3Ab%5Cc@localhost:5432/app?schema=public&sslmode=verify-full', '/private/pgpass');
    expect(result.env).toMatchObject({ PGDATABASE: 'app', PGPASSFILE: '/private/pgpass', PGSSLMODE: 'verify-full' });
    expect(result.env).not.toHaveProperty('DATABASE_URL');
    expect(result.env).not.toHaveProperty('PGPASSWORD');
    expect(result.password).toBe('localhost:5432:*:operator:a\\:b\\\\c\n');
  });

  it('rejects unsupported connection options and line injection without echoing secrets', () => {
    expect(() => connectionEnvironment('postgresql://operator:secret@localhost/app?host=remote', '/private/pgpass')).toThrow('Unsupported connection URL parameter');
    expect(() => connectionEnvironment('postgresql://operator:secret%0Ainjection@localhost/app', '/private/pgpass')).toThrow('Invalid connection credential characters');
    expect(() => connectionEnvironment('secret-invalid-url', '/private/pgpass')).toThrow('A valid PostgreSQL connection URL is required.');
  });

  it('rejects unsafe retention before opening a database connection', async () => {
    await expect(backup('invalid', '/unused', 0)).rejects.toThrow('Retention must be a positive number');
    await expect(backup('invalid', '/unused', Number.NaN)).rejects.toThrow('Retention must be a positive number');
  });

  it('refuses arbitrary archives before creating a database', async () => {
    await expect(restore('invalid', '/tmp/production.dump')).rejects.toThrow('Use an archive produced by db:backup');
  });

  it('rejects a tampered archive before creating a database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wa-backup-unit-'));
    temporaryDirectories.push(directory);
    const archive = join(directory, 'wa-backup-1234567890123-00000000-0000-0000-0000-000000000000.dump');
    await writeFile(archive, 'tampered', { mode: 0o600 });
    await writeFile(`${archive}.json`, JSON.stringify({ version: 1, sha256: 'incorrect' }), { mode: 0o600 });
    await expect(restore('invalid', archive)).rejects.toThrow('Backup manifest or checksum mismatch');
  });
});
