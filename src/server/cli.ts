#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { openDb } from './db.js';
import { scanAll } from './scanner/index.js';

const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');
const DB_PATH = join(homedir(), '.cc-usage', 'usage.db');

const program = new Command();
program.name('ccu').description('Claude Code usage dashboard').version('0.1.0');

program.command('scan')
  .description('Scan ~/.claude/projects/ and index messages into SQLite')
  .action(async () => {
    if (!existsSync(CLAUDE_PROJECTS)) {
      console.error(chalk.red(`Not found: ${CLAUDE_PROJECTS}`));
      process.exit(1);
    }
    const db = openDb(DB_PATH);
    const t0 = Date.now();
    const r = scanAll(db, CLAUDE_PROJECTS);
    const total = (db.prepare('SELECT COUNT(*) as n FROM messages').get() as any).n;
    console.log(chalk.green(
      `Scanned ${r.scannedFiles} files, +${r.newMessages} messages in ${Date.now() - t0}ms. Total: ${total}`
    ));
    db.close();
  });

program.parseAsync();
