import Fastify, { type FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { registerAdmin } from './routes/admin.js';

export interface AppDeps {
  db: DatabaseType;
  projectsRoot: string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  registerAdmin(app, deps);
  return app;
}
