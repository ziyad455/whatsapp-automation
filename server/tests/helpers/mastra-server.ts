import { spawn, type ChildProcess } from 'node:child_process';
import { devNull } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

type StartedMastraServer = {
  baseUrl: string;
  stop: () => Promise<void>;
};

type StartMastraServerOptions = {
  databaseUrl: string;
  port: number;
};

const serverRoot = resolve(import.meta.dirname, '../..');
const mastraExecutable = resolve(
  serverRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'mastra.cmd' : 'mastra',
);

const stopProcess = async (process_: ChildProcess): Promise<void> => {
  if (process_.exitCode !== null || process_.signalCode !== null) {
    return;
  }

  const exited = new Promise<void>(resolveExit => {
    process_.once('exit', () => resolveExit());
  });

  if (process.platform === 'win32' || !process_.pid) {
    process_.kill('SIGTERM');
  } else {
    process.kill(-process_.pid, 'SIGTERM');
  }

  const stopped = await Promise.race([
    exited.then(() => true),
    delay(5_000).then(() => false),
  ]);

  if (!stopped && process_.exitCode === null && process_.signalCode === null) {
    if (process.platform === 'win32' || !process_.pid) {
      process_.kill('SIGKILL');
    } else {
      process.kill(-process_.pid, 'SIGKILL');
    }

    await exited;
  }
};

export const startMastraServer = async ({
  databaseUrl,
  port,
}: StartMastraServerOptions): Promise<StartedMastraServer> => {
  const baseUrl = `http://127.0.0.1:${port}`;
  const process_ = spawn(mastraExecutable, ['dev', '--env', devNull], {
    cwd: serverRoot,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      BETTER_AUTH_URL: baseUrl,
      DATABASE_URL: databaseUrl,
      DASHBOARD_URL: process.env.DASHBOARD_URL ?? 'http://localhost:5173',
      MASTRA_OBSERVABILITY_DATABASE_PATH: ':memory:',
      NODE_ENV: 'test',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';

  const recordOutput = (chunk: Buffer): void => {
    output = `${output}${chunk.toString()}`.slice(-8_000);
  };

  process_.stdout?.on('data', recordOutput);
  process_.stderr?.on('data', recordOutput);

  const deadline = Date.now() + 45_000;

  while (Date.now() < deadline) {
    if (process_.exitCode !== null) {
      throw new Error(`Mastra exited before becoming ready.\n${output}`);
    }

    try {
      const response = await fetch(`${baseUrl}/health`);

      if (response.ok) {
        return {
          baseUrl,
          stop: () => stopProcess(process_),
        };
      }
    } catch {
      // The server has not bound its port yet.
    }

    await delay(200);
  }

  await stopProcess(process_);
  throw new Error(`Mastra did not become ready before the test timeout.\n${output}`);
};
