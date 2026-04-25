import Fastify, { type FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { registerAdmin } from './routes/admin.js';
import { registerOverview } from './routes/overview.js';
import { registerProjects } from './routes/projects.js';
import { registerSessions } from './routes/sessions.js';
import { registerCost } from './routes/cost.js';
import { registerPricing } from './routes/pricing.js';
import { registerStatic } from './staticServe.js';

export interface AppDeps {
  db: DatabaseType;
  projectsRoot: string;
  webDir?: string;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerAdmin(app, deps);
  registerOverview(app, deps.db);
  registerProjects(app, deps.db);
  registerSessions(app, deps.db);
  registerCost(app, deps.db);
  registerPricing(app, { db: deps.db });
  if (deps.webDir) await registerStatic(app, deps.webDir);
  return app;
}
