import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server/cli.ts'],
  format: ['esm'],
  outDir: 'dist/server',
  clean: true,
  target: 'node22',
  shims: true,
  sourcemap: true,
  noExternal: [],
  external: [],
  async onSuccess() {
    const { cpSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    mkdirSync(join('dist', 'server', 'migrations'), { recursive: true });
    cpSync('src/server/migrations', join('dist', 'server', 'migrations'), { recursive: true });
  },
});
