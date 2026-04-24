import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';

export async function registerStatic(app: FastifyInstance, webDir: string) {
  if (!existsSync(webDir)) return;
  await app.register(fastifyStatic, { root: webDir, prefix: '/' });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}
