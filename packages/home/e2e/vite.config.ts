import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  server: { port: 1421, strictPort: true },
  resolve: {
    alias: {
      '@varve/home': resolve(__dirname, '..'),
      '@varve/platform': resolve(__dirname, '../../platform/src'),
      '@varve/engine': resolve(__dirname, '../../engine/src'),
      '@varve/scene': resolve(__dirname, '../../scene/src'),
      '@varve/ui': resolve(__dirname, '../../ui/src'),
      '@varve/shared': resolve(__dirname, '../../shared/src'),
    },
  },
  esbuild: { tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } } },
});
