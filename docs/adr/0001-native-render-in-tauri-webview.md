# ADR-0001: Native engine renders to the Tauri webview via scene-IR replay

- **Status:** Accepted (empirically validated, task 0.2)
- **Date:** 2026-06-27
- **Supersedes:** none
- **Related:** Strata plan §0.3 (the wedge), §1.2 (wgpu + lyon + tiny-skia)

## Context

The defining architectural rule (Strata plan §0.3) is that the desktop app runs
the engine as **natively compiled Rust**, not WebAssembly, to escape the browser
WASM memory ceiling (validated: wasm32 is hard-capped at ≤4 GB, default 2 GB —
see Research basis in `crates/varve-engine/src/lib.rs`). Tauri 2 hosts the UI in
the **system webview** (WebKitGTK on Linux, WebView2 on Windows, WKWebView on
macOS).

The unstated hard problem: a native `wgpu` GPU surface **cannot live inside the
webview DOM**. Linking the Rust engine into the Tauri binary is trivial;
**displaying native-rendered output inside the HTML UI is the actual challenge.**
This ADR resolves how pixels get to the screen without violating the wedge.

## Decision

**Render by IR-replay, not by pixel-push.**

1. The native engine (`crates/varve-engine`) computes the scene: geometry,
   layout, boolean ops, hit-testing, the document model — all in native memory
   (unbounded by the WASM ceiling). This is the heavy work and it stays native.
2. The engine emits a **compact render-command IR** (ordered draw list: paths,
   fills, strokes, clips, glyphs) — KB-scale, not MB.
3. The IR crosses the Tauri IPC boundary (`tauri::ipc::Response` for binary, or
   serde-JSON for the list).
4. The **webview replays the IR to a `<canvas>`** — canvas2D initially, WebGPU
   once WebKitGTK/WebView2/WKWebView support is confirmed across targets.

The webview is treated purely as a **GPU/drawing target**, exactly like a
monitor. The document and its processing never leave native memory.

## Evidence (task 0.2 spike, 2026-06-27, CachyOS / Wayland / WebKitGTK 2.52.4)

Head-to-head measurement, each mode run flat-out for 5 s, 600 animated shapes,
canvas 960×600 (`apps/desktop`, `report` command stdout):

| Mode | fps | payload/frame | bandwidth | result |
|---|---|---|---|---|
| **IR-replay** (canvas2D `fillRect`) | **86.4** | ~42 KB | 3.6 MB/s | clears 60 Hz |
| **Pixel-push** (RGBA `putImageData`) | **8.5** | 2.30 MB | 19.6 MB/s | below 30 Hz target |

- IR-replay is **~10× faster** than pixel-push and **~55× smaller** per payload.
- At 1080p the pixel payload would be ~8.3 MB/frame; pixel-push would be even
  slower. Pixel-push is rejected for interactive use by the data.
- 86 fps is above a 60 Hz display refresh, so the interactive bottleneck moves
  to vsync, not the transport — exactly what we want.

## Alternatives considered

- **Pixel-push (native rasterize → RGBA → IPC → canvas).** Rejected: 8.5 fps at
  960×600. Bandwidth-bound. Kept only as the `tiny-skia` CPU fallback for
  headless/export paths where latency is irrelevant.
- **Native overlay window** (separate `winit`+`wgpu` surface positioned over the
  webview's canvas region). Highest raw GPU perf, but fights Wayland fractional
  scaling, z-order, and multi-monitor sync. **Deferred** as a fallback if
  WebGPU replay cannot handle a specific GPU-heavy effect (e.g. complex
  filters). Not the default.
- **WebGPU with native engine compute** (the chosen direction, upgraded from
  canvas2D replay once available). Engine stays native; only draw-call replay
  uses the webview's WebGPU. This is the Phase-1+ target.

## Consequences

- **Positive**
  - The wedge (§0.3) is preserved: the document and engine state live in native
    memory, unbounded by the WASM ceiling. Only a tiny IR crosses IPC.
  - One facade (`packages/engine`) drives both desktop (native IR source) and
    web (wasm-pack IR source); the replay layer is shared.
  - `tiny-skia` remains valuable for headless render/export/tests, not display.
- **Negative / accepted costs**
  - We must design and version a stable **render-IR protocol** (task 0.6/0.7).
  - canvas2D replay cannot express every GPU effect (blur, complex blend);
    WebGPU upgrade is required for full fidelity. Until then, advanced effects
    are either approximated or rasterized server-side (tiny-skia) and tiled.
  - Frontend canvas is a single GPU context; multi-window / offscreen canvases
    must be planned if we split editing from preview.

## Open questions (for later tasks)

- Exact IR binary encoding (flat offsets + typed shape records vs serde JSON).
  Prefer binary once the shape set stabilizes.
- WebGPU availability matrix across WebKitGTK / WebView2 / WKWebView and the
  graceful fallback to canvas2D when absent.
