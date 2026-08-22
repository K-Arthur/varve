import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
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
 * instantiates the binary).
 *
 * frame-ancestors is deliberately absent: browsers ignore it when it arrives
 * in a meta tag, and every page load logged a console error saying so. It
 * needs a real response header, which GitHub Pages cannot set — so the demo
 * guards against embedding in script instead (see frameGuard.ts). Anything
 * else here that only works as a header would be equally decorative.
 */
const DEMO_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' blob:",

  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Strip the on-device inference payload from the demo build (VITE_DEMO=1).
 *
 * The demo withholds background removal, upscaling, and visual search (see
 * apps/desktop/src/demo/demoCapabilities.ts), so the ONNX Runtime and the
 * bundled models are dead weight in the deployed artifact — and not small
 * weight: ~39 MB of runtime plus the models directory, which balloons past
 * 600 MB on a machine with a warm model cache because Vite copies public/
 * wholesale. GitHub Pages caps a published site at 1 GB.
 *
 * This runs after the bundle is written and deletes those directories from the
 * output only. Nothing in a demo page load can reach them: the affordances are
 * gated in the UI and the capability check refuses at the call site.
 */
function demoAssetPrunePlugin() {
  const demo = process.env.VITE_DEMO === '1';
  const PRUNED_DIRS = ['models', 'ort-wasm'];
  return {
    name: 'demo-asset-prune',
    apply: 'build' as const,
    enforce: 'post' as const,
    closeBundle() {
      if (!demo) return;
      const outDir = join(process.cwd(), process.env.VITE_DEMO_OUT_DIR ?? 'dist-try');
      let freed = 0;
      for (const dir of PRUNED_DIRS) {
        const target = join(outDir, dir);
        if (!existsSync(target)) continue;
        freed += dirSize(target);
        rmSync(target, { recursive: true, force: true });
      }
      // The ORT runtime also reaches the bundle as an emitted asset via
      // onnxruntime-web's own imports, so the chunk needs removing too.
      const assetsDir = join(outDir, 'assets');
      if (existsSync(assetsDir)) {
        for (const file of readdirSync(assetsDir)) {
          if (!/^ort-wasm.*\.wasm$/.test(file)) continue;
          const target = join(assetsDir, file);
          freed += statSync(target).size;
          rmSync(target, { force: true });
        }
      }
      console.log(
        `[demo-asset-prune] removed ${(freed / 1024 / 1024).toFixed(1)} MB of inference assets`,
      );
    },
  };
}

/** Recursive byte size of a directory, for the prune log line. */
function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

function demoCspPlugin() {
  const demo = process.env.VITE_DEMO === '1';
  return {
    name: 'demo-csp',
    apply: 'build' as const,
    enforce: 'post' as const,
    transformIndexHtml(html: string) {
      if (!demo) return html;
      const meta = `<meta http-equiv="Content-Security-Policy" content="${DEMO_CSP}" />\n    `;
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
  plugins: [react(), ortWasmDevPlugin(), demoCspPlugin(), demoAssetPrunePlugin()],
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
    ...(process.env.VARVE_DISABLE_HMR === '1' ? { hmr: false } : {}),
    watch: {
      // Without this the dev server recursively watches the Rust build
      // output, which is tens of thousands of files, and exhausts the
      // system-wide inotify limit: vite then dies at startup with
      // "ENOSPC: System limit for number of file watchers reached" and the
      // next server on the machine cannot start at all. That is a shared
      // resource, so one careless watcher takes everyone else down with it.
      //
      // Naming `ignored` replaces vite's defaults, so .git and node_modules
      // have to be repeated here.
      ignored: [
        '**/.git/**',
        '**/node_modules/**',
        '**/src-tauri/target/**',
        '**/target/**',
        '**/dist/**',
        '**/dist-*/**',
        '**/test-results*/**',
        '**/playwright-report*/**',
        '**/.capture-tmp/**',
        '**/docs/screenshots/**',
      ],
    },
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
