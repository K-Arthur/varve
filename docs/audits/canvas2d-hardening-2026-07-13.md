# Canvas 2D Production Hardening Report

**Date:** 2026-07-13  
**Environment:** CachyOS/Wayland, Ryzen 7 3750H, GTX 1660 Ti Mobile plus AMD
Vega, Node 26.4, pnpm 11.9, Rust 1.96, WebKitGTK 2.52.5.

## Executive summary and target resolution

The repository does not contain the two production applications described in the
assignment. `apps/web` is an unlisted echo-only scaffold. The production editor is one
Vite/React frontend embedded by Tauri; the same build is used as a Chromium, Firefox,
and WebKit compatibility harness. Work continued after the user confirmed the broader
Canvas scope.

Tauri's Rust engine generates render IR but does not rasterize live pixels. Canvas 2D
is the default live compositor in WebView2, WKWebView, and WebKitGTK; WebGPU is opt-in.
There is a separate Rust PDF renderer with a smaller semantic subset. This pass added
preflight rejection rather than claiming silent parity for unsupported PDF effects.

The shipped work repairs frame/text coordinate placement, trackpad zoom accumulation
and anchoring, blank-frame state leaks, structural raster export, deterministic font
readiness, native/WASM area-text parity, worker camera and image parity, paint/filter
isolation, image clipping, exact export bounds/resource readiness, fractional DPR
lifecycle, portable raster allocation, thumbnail fidelity, unclipped-frame culling,
and several performance and test-infrastructure defects. The maintained contract is
`docs/architecture/canvas2d-system.md`.

## Original architecture and baseline

```text
Scene Document
  -> CanvasArea traversal, style resolution, world transforms and culling
  -> EngineNode[]
  -> native IPC | WASM | TypeScript IR builder
  -> RenderItem[]
  -> Canvas2D default | WebGPU opt-in
  -> browser or Tauri webview pixels
```

The baseline had duplicated live/export converters, local-versus-world transform drift,
incomplete frame/group raster export, a required text IR shape missing from export,
system-dependent default fonts, camera-only worker omissions, unbounded offscreen
allocation, unclipped image/pattern paints, destination-wide filters, fractional-DPR
resize churn, and E2E helper calls that produced `NaN` mouse coordinates. The replay
benchmark was present but undiscoverable. Native WDIO failed before application launch
because published `@wdio/tauri-service@1.2.0` imports an API absent from the pinned
`@wdio/native-utils@2.4.0`.

## Root causes and shipped implementation

### Coordinates, frames, text, and camera

- Area text now persists width and height through scene, document, IR, replay, and
  export. Rust native/WASM IR now retains area/path mode and advanced layout fields.
  Text-edit and floating-toolbar overlays use the artwork world/camera matrix.
- Child creation under translated frames converts world coordinates to parent-local
  coordinates once.
- The former camera-only 512-unit floating-origin shift was removed; semantic origin is
  zero until geometry and camera can be rebased together.
- Zoom/pan/rotation now commit through one camera transaction. High-frequency wheel and
  pinch input advances an interaction-local camera reference so every trackpad delta is
  accumulated before React renders. Cursor, keyboard, tool, marquee, pinch, preset, and
  fit paths use the same transition.
- Dirty-region and compositor `save()` stacks are independently balanced, including
  failures. A leaked clip survives `setTransform()` and was a direct blank-frame risk.
- Cursor readout now subtracts the real canvas client rect through the canonical tool
  coordinate adapter.
- Container culling keeps overflowing children of unclipped offscreen frames alive;
  the real Inspector now exposes the frame's Clip content state.

### Scene, export, fonts, and images

- `render/sceneToEngine.ts` is the canonical node converter. Live, raster, video, and
  spec export share the strict text/path/frame wire contract.
- `render/replayScene.ts` renders scoped descendants with composed transforms, frame
  clipping, masks, z-order, and group isolation; overlays are excluded.
- The bundled default artwork face is IBM Plex Sans Variable. Export requests every
  used face/run through `document.fonts.load()` before awaiting the current
  `document.fonts.ready` promise.
- Raster surfaces capability-detect OffscreenCanvas and fall back to HTML canvas.
  Allocation policy is 16,384 pixels per axis and 33,554,432 total pixels. MIME and
  taint failures are explicit.
- Raster export uses canonical frame/area-text/group bounds, outward-effect padding,
  and awaits every visible image, pattern tile, and alpha mask.
- Native PDF preflight rejects transforms, opacity/blends, paints, effects, filters,
  group isolation/masks, or clipped descendants that `strata-print` cannot reproduce.

### Paint, compositing, lifecycle, and efficiency

- Image and pattern paints clip to the primitive and use bounds-relative origins.
- Complex filters operate on isolated item surfaces. Mixed chains advance through real
  intermediate surfaces. `ctx.filter` is feature-detected with software fallbacks for
  the supported adjustment set and blur.
- Every replay item restores state with `try/finally`. Layer blur has kernel padding;
  isolated groups use zoom/DPR-aware surfaces and effect padding.
- Worker messages and stale-bitmap compensation include rotation, viewport, DPR, and
  document generation. Main and worker images share fit/fill/stretch/tile placement;
  unsupported pattern/mask scenes remain on structural replay. Replaced and partial
  `ImageBitmap` collections are closed.
- Backing sizes are integer-rounded once and respond to DPR changes. The listener also
  works where `matchMedia` is unavailable.
- Closed dialogs unmount their expensive subtree. Thumbnail replay now covers text,
  frames, nested transforms, appearance, opacity, blend, effects, and visibility.
- The unimplemented Display-P3 export choice was removed/migrated to the honest sRGB
  baseline.

## Prioritized backlog

| Priority | Item | Result |
|---|---|---|
| P0 correctness | Frame/text placement, native/WASM text parity, exact structural export bounds/resources, filter sibling corruption, font race | Shipped |
| P0 camera | Accumulated anchored zoom, atomic camera state, blank-frame clip balance | Shipped |
| P1 parity | Worker rotation/DPR/image placement, WebKit `ctx.filter` fallback, image/pattern clipping/loading, PDF structural preflight | Shipped |
| P1 resilience | DPR/context lifecycle, portable surfaces, area budget, explicit export errors | Shipped |
| P2 validation | E2E TypeScript gate, Chromium/Firefox/WebKit workflows, discoverable benchmark | Shipped |
| Medium | Production browser packaging, service worker, browser offline distribution | Deferred: no production web app exists; product/hosting decision required |
| Medium | Streamed tiled encoder for exports above the single-surface budget | Deferred: current proportional clamp is safe; next step is encoder-backed tile streaming without a full final bitmap |
| Medium | Native WDIO execution and Tauri/browser visual comparison | Deferred: dependency incompatibility prevents launch; next step is pinning a coherent WDIO native-utils/service pair and running WebKitWebDriver |
| Medium | Windows/macOS native visual matrix | Deferred: unavailable locally; add observed release runners with captured runtime versions |
| Low | Wide-gamut Display-P3 output | Deferred: requires verified context readback, encoder profiles, and platform fixtures; sRGB is correct today |

No critical or high-severity known issue in the implemented tier is represented by a
TODO, disabled test, placeholder, or silent fallback.

## Research findings

All sources below were accessed 2026-07-13.

- [WHATWG Canvas](https://html.spec.whatwg.org/multipage/canvas.html): context
  attributes, resize state reset, origin-clean security, optional encoders, and
  implementation-defined resampling informed centralized lifecycle, MIME validation,
  taint errors, and tolerant visual comparison.
- [MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas),
  [transferControlToOffscreen](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/transferControlToOffscreen),
  and [ImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap):
  capability-gated worker ownership and explicit bitmap disposal.
- [CSS Font Loading Level 3](https://www.w3.org/TR/css-font-loading/) and
  [MDN FontFaceSet.ready](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/ready):
  a one-time `ready` await does not initiate unused faces, so export loads exact runs.
- [MDN canvas maximum size](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas#maximum_canvas_size):
  no portable engine constant exists; Strata uses a conservative memory policy and
  validation rather than pretending 16K is universally safe.
- [Tauri webview versions](https://v2.tauri.app/reference/webview-versions/),
  [asset protocol security](https://v2.tauri.app/es/security/asset-protocol/), and
  [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution):
  the desktop product is three runtime families with different version and origin
  policies.
- [WebKitGTK 2.52 release notes](https://webkitgtk.org/2026/03/18/webkitgtk2.52.0-released.html)
  and [Igalia graphics notes](https://blogs.igalia.com/carlosgc/2024/09/27/graphics-improvements-in-webkitgtk-and-wpewebkit-2-46/):
  current Linux WebKit uses Skia/accelerated Canvas and OffscreenCanvas, but driver and
  software fallbacks still require runtime detection.
- [WebKit wide-gamut Canvas](https://webkit.org/blog/12058/wide-gamut-2d-graphics-using-html-canvas/):
  Safari evidence is not a WebKitGTK guarantee, supporting the sRGB baseline decision.
- Professional workflow references from
  [Figma](https://help.figma.com/hc/en-us/articles/13402894554519-Export-formats-and-settings),
  [Illustrator](https://helpx.adobe.com/sg/illustrator/using/exporting-artwork.html),
  [InDesign](https://helpx.adobe.com/indesign/desktop/save-export-and-publish/save-and-export/adobe-pdf-export-options.html),
  and [Sketch](https://www.sketch.com/docs/designing/importing-and-exporting/)
  support scene-based export jobs, explicit degradation, overlay exclusion, and
  separate preview/final quality policies.

## Tests and workflows

Added or expanded coverage includes coordinate and viewport invariants, fractional
DPR and context lifecycle, worker affine compensation, dirty-region old/new bounds,
strict scene conversion, structural raster replay, font-load determinism, raster
allocation/fallback, filter isolation and software fallbacks, image/pattern clipping,
worker image-mode parity and bitmap disposal, exact frame/area/group export bounds,
multi-resource readiness, thumbnail semantics, PDF group preflight, dialog lifecycle,
frame/text real-pointer creation, large-pan placement, fit-selection zoom, rapid
trackpad wheel accumulation, offscreen unclipped-frame overflow, pixel presence, and
E2E source type-checking.

The production-build Canvas workflow set covers frame creation, nested text placement,
far pan, selection fit, keyboard zoom, burst wheel zoom, object visibility, and overlay
alignment. Cross-engine assertions use one CSS-pixel geometry tolerance; no visual
baseline was blindly updated.

## Performance

Dedicated current measurements: 100 rectangles p50 0.32 ms/p95 0.52 ms, IR 19,781 B;
1,000 rectangles p50 4.47 ms/p95 5.14 ms. Environment was Node 26.4, jsdom/Vitest,
CachyOS/Wayland on the hardware listed above. There was no valid before measurement
because the documented benchmark command excluded `.bench.ts`. These are replay
microbenchmarks, not presentation-frame claims. The full suite under load recorded
higher values, demonstrating why isolated and workload-loaded numbers are not mixed.

## Validation matrix

| Surface | Evidence | Outcome |
|---|---|---|
| Chromium browser harness | Directly executed and observed this session | Production-build Canvas workflows passed |
| Playwright WebKit | Directly executed and observed this session | Production-build Canvas workflows passed; `ctx.filter` absent, fallback covered |
| Firefox browser harness | Directly executed and observed this session | Production-build workflows passed; dev-mode concurrent run can hit Firefox slow-script timeout |
| Linux Tauri WebKitGTK 2.52.5 | Statically verified | Binary/runtime linkage and shared frontend verified; native UI not launched because WDIO failed before launch |
| Windows Tauri/WebView2 | Statically verified | Tauri configuration and shared code path only |
| macOS Tauri/WKWebView | Statically verified | Tauri configuration and shared code path only |
| Tauri native WDIO CI | CI-authored-not-personally-observed | Job/config exists; dependency graph currently needs repair |
| Wayland GPU presentation | Inferred-unverified | Sandbox did not provide trustworthy accelerated desktop presentation evidence |

## Documentation and commits

Updated `docs/architecture/canvas2d-system.md`, `docs/architecture/render-pipeline.md`,
`docs/audits/canvas-system-audit.md`, `docs/perf/ledger.md`, and this report. The
working tree contained extensive pre-existing, overlapping changes in rendering hub
files, Tauri packaging, UI tokens, and E2E tests. Selective commits would falsely claim
ownership or split dependent edits, so no commit was created; the intended breakdown is
scene/export contract, Canvas paint/lifecycle, camera/interaction, tests, then docs.

## Commands and exact outcomes

- `pnpm format`: passed; 1,238 files checked, no fixes in the pre-review gate.
- `pnpm typecheck`: passed for 16 packages plus the E2E TypeScript project.
- `pnpm test`: 443 files passed; 4,816 passed, 1 skipped. A final aggregate rerun
  follows the independent cascade review because the review found additional fixes.
- `cargo test --workspace`: 215 passed; doc tests passed.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: 28 passed.
- `cargo check -p strata-wasm --target wasm32-unknown-unknown`: passed.
- `pnpm --filter @varve/desktop build`: passed; 2,191 modules transformed. Existing
  dynamic-import and large-chunk warnings remain.
- Focused final Canvas/worker/export Vitest set: 130 passed.
- Production/serial zoom workflows: Chromium 3/3, Firefox 3/3, WebKit 3/3 passed.
  Firefox development-mode runs aborted under the headless slow-script/assertion path;
  the same built production workflow passed in 15.1 seconds.
- `pnpm audit:emoji`: passed. `pnpm audit:tokens`: 96/96 passed across three themes
  (required an unsandboxed local `tsx` IPC socket).
- `pnpm lint`: seven repository-wide errors remain in unrelated pre-existing dirty
  files; targeted changed Canvas files pass Biome. These were not weakened or hidden.

## Remaining limitations and risks

- **Medium:** no deployable offline browser application exists.
- **Medium:** arbitrary-size export is clamped, not streamed; it fails safely but is not
  a gigapixel workflow.
- **Medium:** native Tauri UI and PDF visual parity were not directly observed.
- **Medium:** explicit system-font documents remain OS-rasterizer dependent by design;
  bundled IBM Plex output is the deterministic path.
- **Low:** encoded wide-gamut export is not offered; current output is correctly sRGB.
- **Low:** image resampling and text-edge pixels can differ legitimately by engine;
  geometry, alpha, clipping, ordering, and dimensions remain strict.
