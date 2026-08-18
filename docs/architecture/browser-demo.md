# Browser Demo (`/try`)

**Canonical doc for the public browser experience.**

## What it is

The `/try` route is the same Varve editor frontend (apps/desktop, Vite+React) served
from a sub-path of the public site. No separate app, no account required, no data
uploaded. The demo boots directly into a canonical sample document — a 1200×800 poster
with shapes, text, and strokes — so the visitor interacts with a real design within
seconds of page load.

## How it works

- **Runtime detection**: `apps/desktop/src/demo/demoMode.ts` classifies the page
  as demo when `location.pathname` starts with `/try` or the URL carries `?try=1`
  / `?demo=1`. Desktop (Tauri) is excluded regardless of URL.
- **Sample seeding**: `apps/desktop/src/demo/sampleDocument.ts` builds the sample
  document from the scene model API (schema 2.20, `createDocument` + `addNode` +
  `serializeDocument`). Seeded into IndexedDB on first visit; never overwrites user
  edits.
- **Direct open**: `useDemoEntry` orchestrates seed → open → banner. The editor
  mounts without going through Home.
- **Stale-asset recovery**: `staleAssetGuard.ts` watches for failed resource loads
  (old hashed chunks after a deploy) and offers a one-click reload.

## Build

```bash
pnpm --filter @varve/desktop build:try
```

Env vars: `VITE_DEMO=1` (enables CSP injection and demo title), `VITE_BASE_URL=/try/`
(Vite base for asset resolution).

Output: `apps/desktop/dist-try/`.

The website deploy workflow (`website-deploy.yml`) builds this automatically and
stages it into `apps/website/dist/try/` before uploading the combined artifact.

## Deployment

GitHub Pages serves the combined artifact (Astro site at root + demo at `/try/`).
Key facts:
- `try/index.html` is the demo entry; no SPA fallback needed (app has no router).
- Hashed JS/CSS chunks handle cache invalidation.
- `apps/desktop/public/wasm/` (gitignored, built by `just wasm-build-all` in CI)
  provides the WASM engine. Missing WASM degrades to the pure-TS stub renderer.
- CSP is injected via `<meta http-equiv="Content-Security-Policy">` in the demo's
  `index.html` (Vite plugin `demoCspPlugin`). `frame-ancestors 'none'` prevents
  embedding; `wasm-unsafe-eval` + `blob:` enable the WASM engine loader.

## Browser matrix

| Browser | Status |
|---------|--------|
| Chrome/Edge (recent) | Primary target |
| Firefox (recent) | Primary target |
| Safari (recent) | Primary target |
| Mobile Chrome/Safari | Works but desktop-optimized |
| IE11 / legacy | Not supported (no WASM, no ES modules) |

## Known limitations

- Files stored in this browser only (IndexedDB); clearing site data deletes them.
- WASM engine, not native desktop engine — slower rendering on large documents.
- No native PDF/print, no native menus, no auto-updates.
- Background removal and upscaling use smaller on-device ONNX models.
- No service worker; offline only while the tab is open.

## Testing

- Unit: `apps/desktop/src/demo/*.test.ts` — demo mode detection, sample document
  schema/stability, seeding idempotency.
- E2E: `tests/e2e/browser/try-demo.spec.ts` — boots with `?try=1`, verifies
  sample doc, banner, WASM load, persistence, storage denial, mobile viewport,
  stale-asset guard.
- Smoke: `scripts/website/smoke-pages.mjs` checks `/try/` returns 200 and the
  WASM asset serves with `application/wasm`.

## Entry points

| File | Role |
|------|------|
| `apps/desktop/src/demo/demoMode.ts` | Path/query/Tauri detection |
| `apps/desktop/src/demo/sampleDocument.ts` | Sample doc builder + seeding |
| `apps/desktop/src/demo/useDemoEntry.ts` | Hook: seed + open + banner state |
| `apps/desktop/src/demo/DemoBanner.tsx` | Limitations banner + desktop CTA |
| `apps/desktop/src/demo/staleAssetGuard.ts` | Stale-chunk recovery |
| `apps/desktop/src/demo/demoBanner.css` | Banner styles (token-driven) |
| `apps/desktop/src/App.tsx` | Demo wiring (commitOpen, banner render) |
| `apps/desktop/src/main.tsx` | Stale-asset guard install |
| `apps/desktop/vite.config.ts` | CSP plugin + demo entry restriction |
| `apps/desktop/index.html` | `%BASE_URL%` icons/manifest |
| `packages/engine/src/assets.ts` | resolveAppAssetUrl (shared) |
| `packages/engine/src/wasmLoader.ts` | Asset-base-aware WASM loading |
| `.github/workflows/website-deploy.yml` | WASM build + demo build + staging |
| `scripts/website/stage-demo.mjs` | Copy dist-try → website dist/try |
| `scripts/website/smoke-pages.mjs` | Live /try/ + WASM smoke checks |
| `tests/e2e/browser/try-demo.spec.ts` | E2E spec |
| `docs/architecture/browser-demo.md` | This doc |

## Analytics

No analytics events are integrated. The demo is a pure client-side experience.
Analytics (Plausible) will only be integrated after Prompt 10/11 approval. No
document content, filenames, or layer names are ever transmitted.
