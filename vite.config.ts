import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:5173' },
  },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
  },
});
