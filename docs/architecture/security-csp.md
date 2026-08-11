# Content Security Policy (CSP) — Varve Desktop

Varve Desktop enforces a Content Security Policy (CSP) on all webview
windows. The policy is configured in `apps/desktop/src-tauri/tauri.conf.json`
under `app.security.csp` (production) and `app.security.devCsp` (development).

## Why `csp: null` was unsafe

With `csp: null`, Tauri applied no Content Security Policy, effectively
allowing `default-src * 'unsafe-inline' 'unsafe-eval'`. Any successful XSS
attack — including via imported SVG/HTML or pasted content — could:

- Load and execute arbitrary JavaScript from any origin
- Access the full Tauri IPC surface (`window.__TAURI__`) including
  filesystem read/write
- Make outbound HTTP requests to any server
- Execute `eval()` / `new Function()` to bypass any remaining restrictions

## Policy design

The policy defaults to `'self'` and explicitly allows only the resources
the application requires:

| Directive | Production sources | Purpose |
|---|---|---|
| `default-src` | `'self'` | Default fallback |
| `script-src` | `'self' 'wasm-unsafe-eval' blob:` | Bundled JS, WASM execution, WASM glue loading |
| `style-src` | `'self' 'unsafe-inline'` | Bundled CSS, React inline styles |
| `img-src` | `'self' data: blob: https:` | Local icons, canvas previews, user images |
| `font-src` | `'self' data:` | Bundled woff2 fonts |
| `connect-src` | `'self' ipc: … github.com huggingface.co` | Tauri IPC, model downloads |
| `worker-src` | `'self'` | Web Workers (all same-origin) |
| `media-src` | `'self' blob: data:` | Video export blobs |
| `object-src` | `'none'` | No plugins |
| `frame-src` | `'none'` | No iframes |
| `base-uri` | `'self'` | No base tag injection |
| `form-action` | `'none'` | No native form posts |
| `manifest-src` | `'self'` | PWA manifest |

### Development-only additions

The `devCsp` adds `ws://localhost:1420` to `connect-src` for the Vite HMR
WebSocket. This entry does NOT appear in the production policy.

### `connect-src` remote origins

| Origin | Purpose | Risk review |
|---|---|---|
| `https://github.com` | rembg model releases | Allowlisted; user-initiated download |
| `https://huggingface.co` | ML model downloads | Allowlisted; user-initiated download |
| `https://raw.githubusercontent.com` | OCR dictionary files | Allowlisted; required for OCR text decoding |
| `https://www.googleapis.com` | Google Fonts API (dormant) | **Dormant code** — `GoogleFontsProvider` is exported but never instantiated. Remove this origin when the provider is deleted or made opt-in. |

### `'wasm-unsafe-eval'` justification

Required because ONNX Runtime (`onnxruntime-web`) and `varve-wasm`
use WebAssembly with `eval`-style instantiation. The `'blob:'` source
is required because the WASM glue loader (`wasmLoader.ts`) fetches
`.js` glue source and imports it from a `blob:` URL to bypass Vite
dev-server module-transform restrictions.

### `'unsafe-inline'` for `style-src` justification

React's `style={{}}` pattern uses the CSSOM `element.style` IDL
attribute, which is NOT blocked by CSP. The `'unsafe-inline'`
allowance covers the rare cases where `element.style.cssText` or
`setAttribute('style', …)` is used. Tauri adds nonces to inline
`<style>` blocks in HTML at build time.

## CSP and Tauri asset modification

Tauri automatically appends nonce/hash sources to the CSP at build
time:

- **Inline `<script>` blocks** are hashed → added to `script-src`
- **Inline `<style>` blocks** are nonced → added to `style-src`
- **External scripts** referenced in HTML are nonced → added to `script-src`

This means the `index.html` boot splash `<style>` block and the inline
performance-mark `<script>` are handled automatically. Do NOT disable
this by setting `dangerousDisableAssetCspModification`.

## Removed unsafe patterns

The following unsafe patterns were identified and fixed:

1. **`new Function()` in state machine runtime** (`packages/scene/src/state-machine-runtime.ts`)
   — Replaced with a safe recursive-descent expression parser that
   supports comparison, logical, and arithmetic operators without
   dynamic code execution.

2. **`js_sys::eval()` in varve-wasm** (`crates/varve-wasm/src/lib.rs`)
   — Replaced with `web_sys::window().navigator().hardware_concurrency()`
   to detect CPU core count without `eval()`.

3. **`style.cssText` in accessibility announcer** (`packages/prototype/src/accessibility.ts`)
   — Replaced with individual `element.style.property = value` assignments.

## Diagnostics

In development (`import.meta.env.DEV`), CSP violation events are captured
by `apps/desktop/src/security/cspDiagnostics.ts` and logged to the console
with the blocked directive and sanitized source. Local paths (`file://`,
`tauri://`, `http://ipc.localhost`) are masked to prevent information
leakage.

Example console output:

```
[csp] blocked script-src from https://evil.com/inject.js — add the source to the CSP script-src directive
```

## Testing

`apps/desktop/src/security/cspConfig.test.ts` validates:

- Production CSP is non-null
- `'unsafe-eval'` is absent from both policies
- `'wasm-unsafe-eval'` is present (required for WASM)
- Dev-only `ws://localhost:1420` is absent from production
- Remote origins are exact hosts (no wildcards)
- `object-src` and `frame-src` are `'none'`

`packages/scene/src/state-machine-runtime.test.ts` includes tests
verifying the expression evaluator does not use `new Function()` or
`eval()`, and rejects malicious code injection attempts.

## Adding new domains or resource types

Before adding a new domain or resource type to the CSP:

1. **Can it be bundled locally?** If yes, bundle it. This is always
   preferable to adding a remote origin.
2. **Is it user-initiated?** Downloads triggered by explicit user action
   are lower risk than automatic fetches.
3. **Can the origin be narrowed?** Prefer exact paths over wildcards
   (e.g., `https://github.com/danielgatis/rembg/releases/` over
   `https://github.com`).
4. **Does it need to be in production?** Dev-only resources go in
   `devCsp` only.
5. **Run `pnpm verify:affected`** after any CSP change (plus the CSP
   E2E spec; the planner selects the security-relevant lanes).

Document the addition in the `connect-src` remote origins table above
with purpose and risk review.

## Platform notes

| Platform | WebView | CSP support |
|---|---|---|
| Linux | WebKitGTK 2.52 | Full CSP 3 support |
| Windows | WebView2 | Full CSP 3 support |
| macOS | WKWebView | Full CSP 3 support |

`'wasm-unsafe-eval'` is supported by all three platforms' current
WebView versions. No platform-specific CSP overrides are needed.
