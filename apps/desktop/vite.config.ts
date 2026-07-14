import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Dev-only plugin: serve ort-wasm files directly from public/ort-wasm/ without Vite transform.
 *
 * onnxruntime-web dynamically imports its .mjs/.wasm loader files at runtime. These files
 * live in public/ort-wasm/ (copied from node_modules by postinstall). Vite's dev-server
 * refuses to transform files from publicDir as ES modules by design, causing a 500 error.
 *
 * This plugin intercepts /ort-wasm/* requests during dev and serves them raw with correct
 * Content-Type headers, bypassing Vite's transform middleware entirely. Zero effect on
 * production builds (apply: 'serve').
 */
function ortWasmDevPlugin() {
  return {
    name: 'ort-wasm-dev',
    apply: 'serve' as const,
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url?.startsWith('/ort-wasm/')) {
          const publicDir = join(process.cwd(), 'public', 'ort-wasm');
          const filePath = join(publicDir, req.url.slice('/ort-wasm/'.length));
          try {
            const data = readFileSync(filePath);
            const ext = req.url.split('.').pop();
            const contentType =
              ext === 'mjs'
                ? 'text/javascript'
                : ext === 'wasm'
                  ? 'application/wasm'
                  : 'application/octet-stream';
            res.setHeader('Content-Type', contentType);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(data);
          } catch {
            res.statusCode = 404;
            res.end('Not found');
          }
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), ortWasmDevPlugin()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  optimizeDeps: {
    exclude: ['fast-check'],
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          onnxruntime: ['onnxruntime-web'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
