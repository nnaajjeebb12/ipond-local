/**
 * Cloud sync worker — ships local readings to the main server, then exits.
 *
 * Run every 5 minutes from cron (see README). Safe to run concurrently with a
 * manual sync from the dashboard: rows are only marked after the server
 * confirms them, and the receiver de-duplicates on (pond_id, time).
 *
 *   npm run sync-worker
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';
import { runSync } from '../src/lib/sync';

function loadEnv(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {
    // .env may not exist in production
  }
}

loadEnv();

const LOG_PATH =
  process.env.SYNC_LOG_PATH ?? resolve(homedir(), 'logs', 'sync-worker.log');

function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, stamped, 'utf8');
  } catch (err) {
    // A broken log path must never stop a sync.
    console.error('sync_log_write_error', err);
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  ssl: false,
});

async function main(): Promise<void> {
  log('--- sync run start ---');

  const result = await runSync(pool, log);

  log(
    `result: ${result.reason} | synced=${result.synced} pending=${result.pending} batches=${result.batches}`,
  );
  log('--- sync run end ---');

  // One line to stdout; cron appends this to the same file.
  console.log(
    `sync: ${result.reason} — synced ${result.synced}, ${result.pending} pending`,
  );
}

main()
  .catch((err) => {
    log(`fatal: ${String(err)}`);
    console.error('sync_worker_fatal', err);
  })
  .finally(async () => {
    await pool.end().catch(() => {});

    // Exit 0 no matter what happened: cron reads the exit code, and "no
    // internet" is a normal outcome, not a failure.
    process.exitCode = 0;

    // Do NOT call process.exit() here. Tearing down a failed fetch leaves an
    // async handle mid-close, and exiting on top of it aborts the process with
    // a libuv assertion (exit 127) even though the sync itself was fine.
    // Instead let the loop drain and exit naturally. The unref'd timer does not
    // hold the process open, but still fires as a backstop if some keep-alive
    // socket would otherwise hang the run.
    const bail = setTimeout(() => process.exit(0), 2000);
    bail.unref();
  });
