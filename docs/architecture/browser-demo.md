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
  edits. Its fonts are preloaded before the document opens.
- **Direct open**: `useDemoEntry` orchestrates seed → open → banner. The editor
  mounts without going through Home.
- **Capability restrictions**: `demoCapabilities.ts` declares what the demo
  withholds (below) before React mounts.
- **First-run suppression**: `demoOnboarding.ts` marks onboarding complete so no
  first-run surface covers the sample. Every demo visitor is a first-time user, so
  anything gated on "first run" fires on *every* load.
- **Frame guard**: `frameGuard.ts` refuses to run inside another site's frame.
- **Stale-asset recovery**: `staleAssetGuard.ts` watches for failed resource loads
  (old hashed chunks after a deploy) and offers a one-click reload.

## What the demo withholds — and why

Restrictions are declared once and read through `packages/editor/src/capabilities/
restrictions.ts`. The default is "nothing restricted", so desktop and the ordinary
web build are unaffected. Each line is a real browser limit, not an artificial lock.

| Withheld | Reason |
|----------|--------|
| On-device inference (background removal, upscaling, visual search) | ~25 MB ONNX Runtime download before the first result, then a heavy compute job in the tab. Also the clearest case where native genuinely wins. |
| Print production (PDF, CMYK, bleed, colour-managed output) | No pipeline to hand it to — `getPrinters()` returns empty in a browser. |
| Workspaces beyond Design / Draw / Photo | Print is broken per the above; Motion needs a frame budget WASM + Canvas2D in a tab cannot hold; Codegen, Logo, and Email are narrow power-user surfaces. |

**Raster and vector export stay.** PNG, JPEG, WebP, and SVG all work, so a visitor
can always take their work out — the demo is not a trap.

Gating sits at choke points, not leaves: `requestWorkspaceSwitch` is where tabs,
shortcuts, the command palette, deep links, and action handlers all converge, so
refusing there closes every route at once. Export is refused per job rather than per
batch, so a mixed selection still delivers its PNG and SVG.

## Build

```bash
pnpm --filter @varve/desktop build:try
```

Env vars: `VITE_DEMO=1` (CSP injection, asset pruning, demo title),
`VITE_BASE_URL=/try/` (Vite base for asset resolution).

Output: `apps/desktop/dist-try/` — **~20 MB**.

Because the demo withholds inference, `demoAssetPrunePlugin` deletes `models/`,
`ort-wasm/`, and the emitted ORT wasm chunk from the output after the bundle is
written. This matters more than it sounds: Vite copies `public/` wholesale and
`public/models/*.onnx` is gitignored, so CI produced ~97 MB while a developer with a
warm ONNX cache produced **706 MB** — against GitHub Pages' 1 GB site cap.
`stage-demo.mjs` enforces a 120 MB budget and fails the build rather than staging
silently.

## Deployment

GitHub Pages serves the combined artifact (Astro site at root + demo at `/try/`).
Key facts:
- `try/index.html` is the demo entry; no SPA fallback needed (app has no router).
- Hashed JS/CSS chunks handle cache invalidation.
- `apps/desktop/public/wasm/` (gitignored, built by `just wasm-build-all` in CI)
  provides the WASM engine. Missing WASM degrades to the pure-TS stub renderer.
- CSP is injected via `<meta http-equiv="Content-Security-Policy">` in the demo's
  `index.html` (Vite plugin `demoCspPlugin`). `wasm-unsafe-eval` + `blob:` enable
  the WASM engine loader.
- **`frame-ancestors` is deliberately not in the CSP.** Browsers ignore it when it
  arrives in a meta tag — it logged a console error on every load and protected
  nothing. It needs a response header, which GitHub Pages cannot set, so
  `frameGuard.ts` does the job in script. That is weaker than the header: a
  sandboxed frame can block the break-out, leaving only the notice. The demo holds
  no credentials and performs no privileged action, so this is a
  brand/misattribution control, not a boundary protecting visitor data.

## Browser matrix

| Browser | Status |
|---------|--------|
| Chrome/Edge (recent) | Primary target — verified locally, demo spec 11/11 and readiness spec 12/12 |
| Firefox (recent) | Primary target — verified locally, demo spec 11/11 (including save/reopen, the path that lacks File System Access) |
| Safari (recent) | Primary target — CI only. Playwright's WebKit build cannot launch on Arch/CachyOS without `flite` and `libbacktrace`; see below |
| Mobile Chrome/Safari | Works but desktop-optimised |
| No WebAssembly, or no ES modules | Explicit "This browser cannot run Varve" screen naming what is missing, with a desktop download link |

To verify WebKit locally on Arch/CachyOS: `sudo pacman -S flite libbacktrace`,
then `npx playwright test tests/e2e/browser/try-demo.spec.ts --project=webkit`.
Playwright's own `install-deps` cannot help — it shells out to `apt-get`. The
missing sonames are the flite speech-synthesis family and `libbacktrace.so.0`;
ICU is *not* among them despite what the installer's message claims.

## Known limitations

- Files stored in this browser only (IndexedDB); clearing site data deletes them.
- WASM engine, not native desktop engine — slower rendering on large documents.
- No autosave: edits must be saved explicitly (Ctrl+S), and anything after the
  last save is lost on close. An explicit save does now update the browser-local
  copy in every browser, so reopening restores the saved work — that was broken
  in Firefox and Safari until the download-only mirror was added.
- No service worker; offline only while the tab is open.
- Background removal, upscaling, print production, and five workspaces are
  desktop-only (see above).
- The sample document opens at 100% zoom rather than fitted to the viewport, so a
  visitor sees the poster cropped until they zoom out. `Shell` has no fit-on-open
  prop; adding one is the fix.

## Testing

- Unit: `apps/desktop/src/demo/*.test.ts` — demo mode detection, sample document
  schema/stability, seeding idempotency, capability wiring.
  `packages/editor/src/capabilities/restrictions.test.ts` — restriction semantics.
- E2E: `tests/e2e/browser/try-demo.spec.ts` — boots with `?try=1`, verifies sample
  doc, banner, WASM load, persistence, storage denial, mobile viewport, workspace
  gating, clean boot (no covering modal), and stale-asset recovery *inside the
  viewport* (it once rendered below the fold, unreachable).
- Smoke: `scripts/website/smoke-pages.mjs` checks `/try/` returns 200 and the
  WASM asset serves with `application/wasm`.

## Entry points

| File | Role |
|------|------|
| `apps/desktop/src/demo/demoMode.ts` | Path/query/Tauri detection |
| `apps/desktop/src/demo/demoCapabilities.ts` | What the demo withholds |
| `apps/desktop/src/demo/demoOnboarding.ts` | First-run suppression |
| `apps/desktop/src/demo/frameGuard.ts` | Anti-embedding guard |
| `apps/desktop/src/demo/sampleDocument.ts` | Sample doc builder, seeding, font preload |
| `apps/desktop/src/demo/useDemoEntry.ts` | Hook: seed + open + banner state |
| `apps/desktop/src/demo/DemoBanner.tsx` | Limitations banner + desktop CTA |
| `apps/desktop/src/demo/staleAssetGuard.ts` | Stale-chunk recovery |
| `packages/editor/src/capabilities/restrictions.ts` | Restriction registry |
| `apps/desktop/index.html` | Boot fallback + unsupported-browser screen |
| `apps/desktop/vite.config.ts` | CSP plugin + asset prune plugin |
| `scripts/website/stage-demo.mjs` | Stage dist-try → website dist/try, size budget |
| `.github/workflows/website-deploy.yml` | WASM build + demo build + staging |
| `tests/e2e/browser/try-demo.spec.ts` | E2E spec |

## Analytics

The demo bundle itself sends nothing — its analytics client is the no-op provider,
so no document content, filenames, or layer names can leave the browser.

One approved event fires, and it fires from the **website**, not the demo:
`browser_demo_launched` with `entry: 'website'` when a visitor clicks a Try CTA.
A visitor arriving at `/try` directly is not observable from the site, so `'direct'`
is never sent — reporting it would be invented data.
