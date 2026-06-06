#!/usr/bin/env node
/**
 * Drop + recreate the screenshots database, run migrations, and load the
 * starter household seed. Called by build-gif.mjs *before* Playwright
 * starts, so the API process never races a missing DB.
 *
 * Dropping a database is destructive, so it asks for confirmation first.
 * Pass `--yes` (or set SCREENSHOT_DB_CONFIRM=yes) to skip the prompt; without
 * a terminal and without either, it refuses to run.
 *
 * Environment overrides: SCREENSHOT_DB, POSTGRES_HOST, POSTGRES_PORT,
 * POSTGRES_USER, POSTGRES_PASSWORD.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import pg from 'pg';

const { Client } = pg;

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const dbName = process.env.SCREENSHOT_DB ?? 'holocron_screenshots';
const host = process.env.POSTGRES_HOST ?? 'localhost';
const port = Number(process.env.POSTGRES_PORT ?? 5432);
const user = process.env.POSTGRES_USER ?? 'holocron';
const password = process.env.POSTGRES_PASSWORD ?? 'holocron';

// Databases this script must never drop, whatever SCREENSHOT_DB says: the
// server's own, and the app's default dev/production database.
const PROTECTED_DBS = new Set(['postgres', 'template0', 'template1', 'holocron']);

async function main() {
  if (PROTECTED_DBS.has(dbName)) {
    throw new Error(`refusing to drop protected database "${dbName}" (set SCREENSHOT_DB to a throwaway name)`);
  }
  await confirm(`Drop and recreate database "${dbName}" on ${host}:${port}?`);

  console.log(`[prepare-db] recreating database "${dbName}" on ${host}:${port}…`);
  await recreate();

  const childEnv = {
    ...process.env,
    POSTGRES_HOST: host,
    POSTGRES_PORT: String(port),
    POSTGRES_USER: user,
    POSTGRES_PASSWORD: password,
    POSTGRES_DB: dbName,
  };

  console.log('[prepare-db] running migrations…');
  run('npm', ['--workspace', 'apps/api', 'run', 'migration:run'], childEnv);

  console.log('[prepare-db] running seed…');
  run('npm', ['--workspace', 'apps/api', 'run', 'seed'], childEnv);

  console.log('[prepare-db] done.');
}

async function confirm(question) {
  if (process.argv.includes('--yes') || process.env.SCREENSHOT_DB_CONFIRM === 'yes') return;
  if (!process.stdin.isTTY) {
    throw new Error(`${question} Not confirmed: rerun with --yes or SCREENSHOT_DB_CONFIRM=yes.`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`[prepare-db] ${question} [y/N] `);
    if (!/^y(es)?$/i.test(answer.trim())) throw new Error('aborted.');
  } finally {
    rl.close();
  }
}

async function recreate() {
  const admin = new Client({ host, port, user, password, database: 'postgres' });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
}

function run(cmd, args, env) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with status ${result.status ?? 'null'}`);
  }
}

main().catch((err) => {
  console.error(`[prepare-db] ${err.message}`);
  process.exit(1);
});
