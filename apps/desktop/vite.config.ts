import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import pkg from './package.json';

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

/**
 * CSP for the public browser-demo build (VITE_DEMO=1) only.
 *
 * The desktop (Tauri) webview must NOT receive this meta tag — its IPC uses a
 * custom protocol that 'self' would block. The demo runs on a plain static
 * host where a meta CSP is the only header we control (GitHub Pages has no
 * _headers support).
 *
 * 'unsafe-inline' is required by the boot-fallback/theme inline scripts that
 * run before React; 'wasm-unsafe-eval' + blob: are required by the WASM
 * engine loader (fetches the glue as text, imports it from a blob: URL, and
 * instantiates the binary). frame-ancestors 'none' prevents the demo from
 * being embedded elsewhere.
 */
const DEMO_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function demoCspPlugin() {
  const demo = process.env.VITE_DEMO === '1';
  return {
    name: 'demo-csp',
    apply: 'build' as const,
    enforce: 'post' as const,
    transformIndexHtml(html: string) {
      if (!demo) return html;
      const meta =
        `<meta http-equiv="Content-Security-Policy" content="${DEMO_CSP}" />\n    `;
      return html.replace('<head>', `<head>\n    ${meta}`);
    },
  };
}

export default defineConfig({
  define: {
    __VARVE_ASSET_BASE__: JSON.stringify(process.env.VITE_BASE_URL ?? '/'),
    // Release stamp for crash reports. Unset in dev; production CI sets it
    // from the tag/channel. Never contains secrets.
    __VARVE_RELEASE__: JSON.stringify({
      appVersion: process.env.VARVE_APP_VERSION ?? pkg.version,
      buildChannel: process.env.VARVE_BUILD_CHANNEL ?? 'dev',
      releaseId: process.env.VARVE_RELEASE_ID ?? undefined,
      gitCommit: process.env.VARVE_GIT_COMMIT ?? undefined,
    }),
  },
  base: process.env.VITE_BASE_URL ?? '/',
  plugins: [react(), ortWasmDevPlugin(), demoCspPlugin()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Opt-in cross-origin isolation. Without it `crossOriginIsolated` is
    // false, which costs on-device inference twice over: SharedArrayBuffer is
    // unavailable so ONNX Runtime cannot use threaded WASM, and
    // RuntimeCapabilities caps a safe model at 50 MB instead of 400 MB — which
    // rules out IS-Net (178 MB) entirely.
    //
    // Off by default because COEP require-corp blocks any cross-origin
    // subresource that does not opt in, which would change how the ordinary
    // dev server loads third-party assets. The screenshot harness turns it on
    // for the scenes that actually run inference.
    ...(process.env.VARVE_CROSS_ORIGIN_ISOLATION === '1'
      ? {
          headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
          },
        }
      : {}),
  },
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
      // The demo build ships only the app entry — e2e.html and
      // visual-harness.html are test harnesses that must never reach the
      // public site.
      ...(process.env.VITE_DEMO === '1'
        ? { input: { index: new URL('./index.html', import.meta.url).pathname } }
        : {}),
    },
  },
  worker: {
    format: 'es',
  },
});
