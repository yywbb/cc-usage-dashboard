import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',
  plugins: [react()],
  server: {
    host: true,
    port: 47822,
    proxy: { '/api': 'http://localhost:47821' },
  },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
  },
});
