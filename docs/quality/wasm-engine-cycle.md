# `engine.ts ↔ wasmLoader.ts` — the dangerous one

This cycle was treated differently from the other 9 catalogued in `docs/quality/cycles.md` §2/§8
(E1) because it's the only one in that set where a real async, order-dependent resource — a WASM
module — sits behind the cycle. The other 9 are either 100% type-erased or a plain synchronous
value cycle with no async boundary. Fixed by dependency inversion, not by moving types, per the
brief. **Status: fixed.** `madge --circular` on the whole engine package now returns `[]` — this
was the last cycle in engine.

## 1. The initialization sequence, before the fix

**`engine.ts`'s only reference to `wasmLoader.ts`**, anywhere in the file, was two identical lines
inside the async body of `createEngine()`:

```ts
const { tryWasmEngine } = await import('./wasmLoader');
```

Not a static import. Not evaluated at module scope. It only ran when `createEngine()` was actually
*called* with `preferred === 'wasm'` or `preferred === 'auto'` with no `__TAURI__` global present.

**`wasmLoader.ts`'s only reference to `engine.ts`** was `import type { Engine } from './engine';`
— erased at compile time (confirmed against `tsconfig.base.json`'s `verbatimModuleSyntax: true` in
`cycles.md` §1). Used only to annotate the return type of two functions that have since moved
(§3).

**What ran at import time, in either module: nothing WASM-related.** `wasmLoader.ts`'s only
module-scope state was `let cachedModule: WasmEngineModule | null = null; let prewarmStarted =
false;` — plain variable declarations, no fetch, no instantiation, no side effect.

**What ran on first call:** `createEngine('wasm')` (or `'auto'` without Tauri) →
`await import('./wasmLoader')` → destructure `tryWasmEngine` → `tryWasmEngine(stubEngine)` →
`loadWasmEngineModule()`, which: checked a module-level cache, then for each candidate WASM URL
(`varve_wasm_simd_bg.wasm`, `varve_wasm_bg.wasm`): `fetch(HEAD)` → fetch the JS glue source as
text → wrap it in a `Blob` → dynamically `import()` the resulting `blob:` URL (a second, unrelated
dynamic import — this loads the wasm-bindgen-generated glue, not `wasmLoader.ts` itself) →
`await mod.default({ module_or_path: fetch(...).then(r => r.arrayBuffer()) })` to instantiate the
actual WASM binary.

**Await points:** `await import('./wasmLoader')` (engine.ts) → `await loadWasmEngineModule()` →
`await fetch(HEAD)` → `await fetch(jsUrl).then(r => r.text())` → `await import(blobUrl)` →
`await mod.default(...)`. Five sequential await points before a `WasmEngineModule` exists.

**A second, independent entry point already existed:** `packages/engine/src/index.ts` (the
package's public barrel) statically re-exported `loadWasmEngineModule`, `prewarmWasmEngine`,
`tryWasmEngine`, and `createWasmEngineFromModule` directly from `./wasmLoader` — meaning
`wasmLoader.ts` was *already* eagerly bundled into anything that imports `@varve/engine` at all,
regardless of `createEngine()`. `packages/editor/src/CanvasArea.tsx` uses this: it calls
`prewarmWasmEngine()` directly (line 770), completely bypassing `engine.ts`, to kick off the WASM
load during idle time before `createEngine()` is ever called. This only worked correctly because
both call sites shared the same module-level `cachedModule` variable — a real, if accidental,
readiness mechanism that had no explicit contract (see §3.3).

## 2. Was the cycle causing a latent problem?

**No active TDZ / "cannot access before initialization" bug found, and there structurally couldn't
be one in this exact shape.** `engine.ts` never reads anything from `wasmLoader.ts` at
module-evaluation time — its only reference is a dynamic `import()` deferred inside an async
function body, which only runs (and only *can* run) after both modules have finished their own
top-level evaluation. `wasmLoader.ts`'s reference back is fully erased. Checked directly: is there
any code path where `engine.ts` reads a `wasmLoader.ts` export before `wasmLoader.ts` has
finished evaluating? No — there's no static edge from `engine.ts` to `wasmLoader.ts` at all before
this fix, so there's nothing for bundler reordering to break.

**But two real, latent problems were found — not TDZ, but exactly the class of bug the brief
warned "appears only in a release build":**

1. **A silent failure path.** If every candidate WASM URL fails (unsupported browser, CSP blocking
   the fetch, corrupt build artifact, out-of-memory during `mod.default(...)` instantiation),
   `loadWasmEngineModuleUncached` swallows the error in an empty `catch {}` and returns `null`.
   `tryWasmEngine` then silently returned `stubEngine()` with **zero logging** — no
   `console.warn`, nothing. Compare to `withStubFallback` a few lines below, which *does* warn when
   a build-IR contract failure happens at runtime. The WASM-load failure path had no equivalent.
   A user on an unsupported browser, or behind a CSP that blocks the WASM binary, would silently
   get the pure-TS stub renderer with no signal anything degraded — exactly the "silent failure...
   fix that too and call it out" case the brief asked about. **Fixed in §3.2.**

2. **An unguarded race between the two entry points.** `prewarmWasmEngine()` (called from
   `CanvasArea.tsx`, main thread, idle time) and `createEngine('wasm'|'auto')` (called from
   wherever the app actually needs an engine) both call `loadWasmEngineModule()` independently.
   The old cache (`if (cachedModule) return cachedModule;`) only short-circuited *after* a load had
   *finished*. If both call sites raced while a load was still in flight, both would independently
   fetch and instantiate the WASM module — wasted network/CPU work, not a correctness bug (both
   would converge on setting `cachedModule`), but exactly the kind of implicit, unguaranteed
   ordering the brief wants replaced with an explicit readiness promise. **Fixed in §3.3.**

## 3. The fix: dependency inversion, not moved types

### 3.1 `wasmLoader.ts` now knows nothing about `Engine`

Removed `import type { Engine } from './engine';` — it's gone, not replaced with anything.
`createWasmEngineFromModule` (shapes a raw module into an `Engine`) and `tryWasmEngine` (load, warn
on failure, fall back to stub) both **moved to `engine.ts`**, which is where the `Engine` interface
actually lives. `wasmLoader.ts`'s remaining job is exactly what the brief specified:
`loadWasmEngineModule(): Promise<WasmEngineModule | null>` — load the raw exports, or fail to
`null`. Nothing more. It has zero imports from `engine.ts`, type or value.

`wasmLoader.ts` needed nothing passed in (no config, no callback, no error handler) — its only
former dependency on `engine.ts` was the `Engine` return-type annotation on functions that don't
live there anymore. There was nothing to invert via a parameter; the fix was relocating the two
functions that actually needed the `Engine` type to the file that owns `Engine`.

### 3.2 The failure path — now one place, one warning

```ts
// engine.ts
let wasmLoadFailureWarned = false;

export async function tryWasmEngine(stubEngineFactory: () => Engine): Promise<Engine> {
  const mod = await loadWasmEngineModule();
  if (!mod) {
    if (!wasmLoadFailureWarned) {
      wasmLoadFailureWarned = true;
      console.warn(
        '[strata-engine] WASM engine failed to load (unsupported browser, CSP blocking the ' +
          'WASM binary, network failure, or a corrupt build artifact); falling back to the ' +
          'pure-TS stub renderer for this session.',
      );
    }
    return stubEngineFactory();
  }
  return createWasmEngineFromModule(mod);
}
```

One place (`tryWasmEngine`, now in `engine.ts`, the sole caller of `loadWasmEngineModule` for the
render-engine use case) decides what a WASM load failure means, and it's now user/developer-visible
instead of silent. De-duped to fire once per session (`wasmLoadFailureWarned`), matching the
existing `withStubFallback` `warnOnce` convention a few lines below it in the same file — without
the de-dupe, every `createEngine('auto')` call in an environment without WASM (e.g. every test in
`engine.test.ts`) would log the warning, which is correct but needlessly noisy; verified this
actually fires exactly once across all 30 `createEngine()` calls in `engine.test.ts` (§5).

### 3.3 The readiness promise — now explicit, not implicit-via-cache

```ts
// wasmLoader.ts
let wasmModulePromise: Promise<WasmEngineModule | null> | null = null;

export function loadWasmEngineModule(): Promise<WasmEngineModule | null> {
  if (!wasmModulePromise) {
    wasmModulePromise = loadWasmEngineModuleUncached().then((mod) => {
      if (!mod) wasmModulePromise = null; // allow retry on next call
      return mod;
    });
  }
  return wasmModulePromise;
}
```

Caches the **in-flight promise**, not just the resolved value. `prewarmWasmEngine()` and
`createEngine('wasm')` now provably share one fetch/instantiate attempt if they race, because both
receive the identical promise object rather than each independently checking a resolved-value
cache that's still `null` mid-flight. A failed load clears the cache so the next call retries —
this preserves the original behavior (which re-fetched on every call after a failure) exactly;
only the concurrent-race case changes. This *is* the deterministic readiness signal the brief asked
for, connectable to any test harness: `await loadWasmEngineModule()` now has a well-defined,
race-safe contract.

### 3.4 Public API preserved

`createWasmEngineFromModule` and `tryWasmEngine` kept their exact names and signatures — only their
file (and, for `tryWasmEngine`, their internal warning behavior) changed. `packages/engine/src/index.ts`
still exports both, now sourced from `./engine` instead of `./wasmLoader`. Checked every consumer
repo-wide: no file outside `packages/engine/src` imports either function directly (both are
reachable only through the `@varve/engine` barrel, which is unchanged), so this is a pure internal
relocation, not a public API change — consistent with "do not change public API surface" for this
pass. The one internal test that imported `createWasmEngineFromModule` directly
(`wasmLoader.test.ts`) was updated to import it from `./engine`.

`engine.ts`'s dynamic `await import('./wasmLoader')` became a plain static
`import { loadWasmEngineModule } from './wasmLoader';` at the top of the file. This costs nothing:
`wasmLoader.ts`'s JS was *already* forced into the module graph unconditionally by `index.ts`'s own
static re-export (§1), so making `engine.ts`'s internal reference static too doesn't add a single
module to the graph that wasn't already reachable. The actual WASM *binary* fetch remains fully
lazy either way — it happens inside a function body (`loadWasmEngineModuleUncached`), gated by an
explicit call to `loadWasmEngineModule()`/`prewarmWasmEngine()`/`createEngine()`, never at module
import time. Static vs. dynamic import of `wasmLoader.ts`'s ~30 lines of JS glue has no bearing on
when the multi-hundred-KB WASM asset itself gets fetched.

## 4. Verification across build modes

**Static/spec-level guarantee (applies to all three modes identically):** the module graph is now
a genuine DAG — `wasmLoader.ts` has zero edges to `engine.ts`, confirmed by `madge --circular`
returning `[]` for the whole package. Per the ECMAScript module specification, a DAG's modules are
evaluated in a single well-defined topological order regardless of which tool does the evaluating
or how it's packaged. There is no "accident of bundler ordering" left for any bundler, in any mode,
to get wrong — that's what makes this fix categorically different from "add a readiness promise on
top of the cycle" (which was considered and rejected; see §3).

**`apps/desktop`'s actual `vite build`/`vite dev` could not be run end-to-end** — confirmed
independently (again) that it's broken for a pre-existing, unrelated reason:
`ERR_MODULE_NOT_FOUND: @vitejs/plugin-react`, failing at Vite *config* load, before touching any
source file. Same failure with or without this change; matches `report-audit.md`'s independent
finding that the production build was already broken. Not fixed here — out of scope, and fixing an
unrelated broken build isn't a "small, mechanical" cycle change.

**What was actually run instead: two real bundles of `packages/engine/src/index.ts` via esbuild
directly** (bypassing the desktop app's broken Vite config entirely — a self-contained,
`@varve/engine`-only bundle), one unminified ("dev"-shaped) and one minified ("prod"-shaped):

| | dev-shaped (unminified) | prod-shaped (minified) |
|---|---|---|
| Bundle succeeds | ✓ | ✓ |
| `wasmLoader.ts`'s resolved import list (via esbuild's metafile, i.e. the real dependency graph, not text search) | `['geometry.ts']` only | `['geometry.ts']` only |

Both bundles' metafiles confirm `wasmLoader.ts` imports *only* `geometry.ts` — zero edge to
`engine.ts`, in either mode, verified by the bundler itself rather than by re-reading the source.
(A cruder check — searching bundle text for the literal function names — also ran, but is
worth flagging as unreliable and is **not** load-bearing here: minification renames identifiers, so
a text search for `createEngine` in the minified output correctly finds nothing even though the
function is present under a mangled name. The metafile-based import-list check above is the real
evidence; the text search was a discarded first attempt, noted so it isn't mistaken for a second
independent confirmation.)

**Tauri release build:** `apps/desktop/src-tauri/tauri.conf.json`'s `beforeBuildCommand` is
`pnpm build`, i.e. the identical `tsc --noEmit && vite build` used for the standalone web build —
there is no third, separate frontend-bundling pipeline for Tauri specifically. The verification
above therefore covers it. Separately: on desktop, `createEngine('native')` is asserted (per this
file's own header comment — "The desktop build MUST select native... no WASM memory ceiling"), so
in practice the WASM path this cycle involved is never exercised at runtime in the Tauri build at
all; it matters only for correctness of the web build and for whoever calls `createEngine('wasm'|'auto')`
without Tauri present. The native/Rust side of the Tauri build is unaffected — it's a different
code path (`nativeEngine()`) that never touches `wasmLoader.ts`.

## 5. Edge cases from the brief

- **Top-level await:** none exists in either file, confirmed by inspection — every `await` in both
  files is inside a function body. No deadlock risk from this mechanism, before or after the fix.
- **Multiple entry points (main thread, worker):** checked every worker file under
  `packages/engine/src` (`upscaleProviders/*Worker*.ts`, `backgroundRemoval/worker.ts`,
  `inference/inferenceWorker.ts`, `denoiseProviders/workerProvider.ts`,
  `colorization/providers/workerProvider.ts`). **None of them reference `createEngine`,
  `wasmLoader`, `tryWasmEngine`, or `loadWasmEngineModule`** — they use entirely separate
  model-loading infrastructure (ONNX Runtime, for background removal / upscaling / denoising /
  colorization), unrelated to this render-engine cycle. `wasmLoader.ts` does host a second,
  independent loader (`tryLoadTraceWasm` / `WasmTraceModule`, for contour tracing) that shares the
  file but not the `Engine` type or any code path with `createEngine` — confirmed it doesn't
  participate in this cycle either. **The render engine (`createEngine`) is only ever instantiated
  on the main thread**, in this codebase, today. Flagging this as "verified: no worker
  instantiates it" rather than "not applicable," since the brief specifically asked to check.
- **Failure path → user-visible error, not a hang:** fixed, §3.2. One place, one de-duplicated
  warning. Nothing hangs — `tryWasmEngine` always resolves, either to a real WASM engine or to
  `stubEngineFactory()`.
- **Prompt 3's harness / deterministic readiness signal:** `loadWasmEngineModule()` is that signal
  — `await`-able, now race-safe under concurrent callers (§3.3), and stable across the whole
  session once resolved successfully.

## 6. Verification performed

- `pnpm --filter @varve/engine typecheck` — clean, before and after.
- `npx madge --circular ... packages/engine/src/index.ts` — `[]`. Zero cycles left in the engine
  package (was 3 at the start of this cycle-fixing effort: `docs/quality/cycles.md` §0/§7/§8).
- `npx vitest run packages/engine/src/engine.test.ts packages/engine/src/wasmLoader.test.ts
  packages/engine/src/bench/wasm-bench.test.ts` — 34/34 passing; confirmed the new warning fires
  exactly once across all 30 `createEngine()` calls in `engine.test.ts` (not 30 times).
- Full engine suite: `npx vitest run packages/engine/src` — **195 files / 2515 tests, all
  passing.**
- Two esbuild bundles (dev-shaped, prod-shaped) of the real `@varve/engine` entry point,
  metafile-verified: `wasmLoader.ts` has exactly one import (`geometry.ts`), in both modes.
- Confirmed `apps/desktop`'s real build is still broken for the same pre-existing, unrelated
  reason as before this change (not fixed, not worsened).

## 7. Ratchet

`.architecture-baseline.json`'s `engine` entry: `count: 0, cycles: []`. Engine is now fully clean —
all three of its original cycles (`filterCompositor ↔ lut ↔ bake`, `raster ↔ raster-size`,
`engine ↔ wasmLoader`) are fixed. `docs/quality/cycles.md`'s running total updates from **8 → 7**
(scene 7, engine 0, ui 0, editor 0).
