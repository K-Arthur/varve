import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  server: { port: 1421, strictPort: true },
  resolve: {
    alias: {
      '@strata/home': resolve(__dirname, '..'),
      '@strata/platform': resolve(__dirname, '../../platform/src'),
      '@strata/engine': resolve(__dirname, '../../engine/src'),
      '@strata/scene': resolve(__dirname, '../../scene/src'),
      '@strata/ui': resolve(__dirname, '../../ui/src'),
      '@strata/shared': resolve(__dirname, '../../shared/src'),
    },
  },
  esbuild: { tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } } },
});
