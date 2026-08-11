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
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(
        (
          req: import('http').IncomingMessage,
          res: import('http').ServerResponse,
          next: import('connect').NextFunction,
        ) => {
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
        },
      );
    },
  };
}

export default defineConfig({
  define: {
    __VARVE_ASSET_BASE__: JSON.stringify(process.env.VITE_BASE_URL ?? '/'),
    // Release stamp for crash reports. Unset in dev; production CI sets it
    // from the tag/channel. Never contains secrets.
    __VARVE_RELEASE__: JSON.stringify({
      appVersion: process.env.VARVE_APP_VERSION ?? '0.1.0',
      buildChannel: process.env.VARVE_BUILD_CHANNEL ?? 'dev',
      releaseId: process.env.VARVE_RELEASE_ID ?? undefined,
      gitCommit: process.env.VARVE_GIT_COMMIT ?? undefined,
    }),
  },
  base: process.env.VITE_BASE_URL ?? '/',
  plugins: [react(), ortWasmDevPlugin()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  optimizeDeps: {
    exclude: ['fast-check'],
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
    // Vite 8 (Rolldown/Oxc): `minify: 'esbuild'` is deprecated and the
    // default minifier is now Oxc. Debug builds stay unminified.
    minify: process.env.TAURI_DEBUG ? false : undefined,
    sourcemap: !!process.env.TAURI_DEBUG,
    // Vite 8 removed the object form of `output.manualChunks`; the Rolldown
    // equivalent is `output.codeSplitting.groups` (keeps onnxruntime-web in
    // its own chunk so the WASM loader path is stable).
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'onnxruntime', test: /onnxruntime-web/ }],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
