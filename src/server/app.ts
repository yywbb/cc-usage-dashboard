import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseType } from './db.js';
import { registerAdmin } from './routes/admin.js';
import { registerOverview } from './routes/overview.js';
import { registerProjects } from './routes/projects.js';
import { registerSessions } from './routes/sessions.js';
import { registerCost } from './routes/cost.js';
import { registerPricing } from './routes/pricing.js';
import { registerCodex } from './routes/codex.js';
import { registerMonitor } from './routes/monitor.js';
import { registerStatic } from './staticServe.js';
import type { Monitor } from './monitor/index.js';

export interface AppDeps {
  db: DatabaseType;
  projectsRoot: string;
  webDir?: string;
  monitor?: Monitor;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerAdmin(app, deps);
  registerOverview(app, deps.db);
  registerProjects(app, deps.db);
  registerSessions(app, deps.db);
  registerCost(app, deps.db);
  registerPricing(app, { db: deps.db });
  registerCodex(app, deps.db);
  registerMonitor(app, { db: deps.db, monitor: deps.monitor });
  if (deps.webDir) await registerStatic(app, deps.webDir);
  return app;
}
