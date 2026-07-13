# WebGPU / WGSL Subsystem Improvement — 2026-07-13

## §0 Resolution (deployment targets)

| Question | Finding | Evidence |
|---|---|---|
| Native `wgpu-rs` in Tauri process? | **No** — zero `wgpu` in any `Cargo.toml` / lockfile | `rg wgpu` empty |
| Where does GPU run? | **(a) System webview** via `navigator.gpu` (JS/TS) | `@strata/compositor` WebGPUBackend |
| Shared vs divergent | **Shared** JS compositor for Tauri webview + browser | Same Vite frontend |
| Linux Tauri WebGPU? | **Unavailable** (WebKitGTK 2.52) | Research 2026-07-13; ADR-0003 |

IR still from Rust native/`wasm`/stub; **display** is Canvas2D (default) or opt-in WebGPU in the webview.

## Prioritized backlog

### Must-complete (this session)

| Sev | Gap | Root cause |
|---|---|---|
| P0 | Prefer-WebGPU blanks the canvas | `WebGPUBackend` binds `getContext('webgpu')` on the content canvas; `CanvasArea.drawContent` requires `getContext('2d')` and early-returns |
| P0 | Affine wrong in SOLID_VERTEX_WGSL | Uses `transform.w` (d) as tx and `transform2.x` (e) as dy scale — breaks all non-trivial transforms |
| P0 | Golden "GPU" test is Canvas2D↔Canvas2D | No `navigator.gpu` in jsdom → both paths are 2D; never catches affine bug |
| P1 | Device loss forces reload | Ownership model made in-place Canvas2D recovery impossible; inverted ownership restores it |
| P1 | Premul mismatch | Canvas `alphaMode: 'premultiplied'` but pipelines output straight alpha / no blend |
| P1 | View rotation omitted | Compositor camera omits `rotation`; CanvasArea doesn't pass it |
| P1 | TS↔Rust WGSL drift | Duplicated strings in `wgsl_validation.rs` |

### Deferred (documented, not silent TODOs)

| Sev | Gap | Why deferred | Next step |
|---|---|---|---|
| P2 | Full primitive parity (path/text/image/effects on GPU) | Large surface; 2D overlay path works | Incremental tessellation after ownership solid |
| P2 | Ellipse dedicated shader | Circle path exists; ellipse via 2D OK | Mirror circle with aspect |
| P2 | Native wgpu overlay | ADR-0003 explicitly deferred; WebKitGTK still no WebGPU | Revisit if filter latency demands it |
| P3 | Pipeline cache across launches | Spec has no app-facing API | Watch W3C; native wgpu only |
| P3 | GPU CI runners | Billing/infra decision (ADR-0003) | Keep manual checklist |

## Environment honesty

- This sandbox: **no `/dev/dri`**, no real GPU adapter.
- Claims labeled executed / static / inferred in the completion report.
