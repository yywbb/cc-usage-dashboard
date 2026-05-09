#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { scanAll } from './scanner/index.js';
import { buildApp } from './app.js';
import { defaultCodexHome } from './scanner/sources/codex/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');
const DB_PATH = join(homedir(), '.cc-usage', 'usage.db');

type SourceArg = 'all' | 'claude' | 'codex';
const VALID_SOURCES: ReadonlySet<SourceArg> = new Set(['all', 'claude', 'codex']);

function parseSource(opt: string | undefined): SourceArg {
  const v = (opt ?? 'all') as SourceArg;
  if (!VALID_SOURCES.has(v)) throw new Error(`--source must be one of: all, claude, codex`);
  return v;
}

const program = new Command();
program.name('ccu').description('Claude Code usage dashboard').version('0.1.0');

program.command('scan')
  .option('--source <s>', 'all | claude | codex', 'all')
  .action(async (opts) => {
    const source = parseSource(opts.source);
    const db = openDb(DB_PATH);
    const t0 = Date.now();
    const r = scanAll(db, CLAUDE_PROJECTS, { source });
    console.log(chalk.green(
      `Scanned ${r.scannedFiles} files (${source}), +${r.newMessages} messages in ${Date.now() - t0}ms`,
    ));
    db.close();
  });

program.command('start')
  .option('-p, --port <port>', 'HTTP port', '47821')
  .option('--no-open', 'Do not auto-open browser')
  .option('--dev', 'Dev mode (no static serve)')
  .option('--source <s>', 'Pre-scan source: all | claude | codex', 'all')
  .action(async (opts) => {
    const source = parseSource(opts.source);
    const db = openDb(DB_PATH);
    console.log(chalk.gray(`Scanning (${source})…  Claude=${CLAUDE_PROJECTS}  Codex=${join(defaultCodexHome(), 'sessions')}`));
    const r = scanAll(db, CLAUDE_PROJECTS, { source });
    console.log(chalk.gray(`  ${r.scannedFiles} files, +${r.newMessages} messages`));
    const webDir = opts.dev ? undefined : resolve(__dirname, '../web');
    const app = await buildApp({ db, projectsRoot: CLAUDE_PROJECTS, webDir });
    const port = await listenWithRetry(app, Number(opts.port));
    const url = `http://localhost:${port}`;
    console.log(chalk.green(`✓ cc-usage-dashboard on ${url}`));
    if (opts.open !== false) open(url).catch(() => {});
  });

program.command('recompute-cost').action(async () => {
  const db = openDb(DB_PATH);
  const app = await buildApp({ db, projectsRoot: CLAUDE_PROJECTS });
  const res = await app.inject({ method: 'POST', url: '/api/recompute-cost' });
  console.log(chalk.green(`✓ ${res.body}`));
  await app.close();
  db.close();
});

async function listenWithRetry(app: any, desiredPort: number): Promise<number> {
  let port = desiredPort;
  for (let i = 0; i < 20; i++) {
    try {
      await app.listen({ port, host: '0.0.0.0' });
      return port;
    } catch (e: any) {
      if (e.code !== 'EADDRINUSE') throw e;
      port++;
    }
  }
  throw new Error(`Cannot find free port in range ${desiredPort}..${desiredPort + 20}`);
}

program.parseAsync();
