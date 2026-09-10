# ADR-0143: Rendering and worker isolation

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The editor window initializes the canvas renderer, worker renderer, WASM
IR path, ONNX model manager, font loading, thumbnail queues, and image
caches. If every auxiliary window repeated this, memory would multiply
(the target profile is a 4 GB machine).

## Alternatives

1. Reuse one code path everywhere (rejected — panel windows would
   initialize the renderer).
2. Explicit per-window resource policy driven by the registry (chosen).

## Decision

- Auxiliary windows use a **minimal boot bundle** (M6):
  `index.html?surface=panel-window&windowId=<opaque>&session=<opaque>`
  with route-level code splitting; they mount only: theme tokens,
  localization, panel chrome, dock rendering, the session client, and the
  panels their dock hosts (registry `loadPolicy: 'lazy'`,
  `capabilities.requires*`).
- Panel-only windows must NOT initialize: canvas rendering, scene
  compositor, GPU contexts, model runtimes, image-processing workers,
  export workers, large image caches — unless a hosted panel genuinely
  requires them (none do in M7).
- Centralized runtimes: model manager, font cache, and collaboration
  connection remain primary-window singletons; auxiliary windows call
  through the broker (ADR-0130) or the platform service, never spawning
  their own.
- Lifecycle cleanup: hidden/minimized windows throttle nonessential work
  (visibility-change gating, reusing `editorFrameRuntime.ts:20` pattern);
  inactive panels suspend expensive observers (registry
  `inactivePolicy: 'suspend'`); timers and event listeners unregister on
  window close (audited via the M15 instrumentation pass).

## Consequences

- An auxiliary Layers window costs a fraction of a second editor window.
- No duplicate model downloads, collaboration sockets, or renderers.

## Migration impact

The auxiliary entry route is new; the primary boot path is unchanged.

## Cross-platform implications

Chunk loading is Vite-based on all OSes; WebKitGTK's older baseline
(chrome105/safari14 targets in `vite.config.ts`) is respected.

## Security implications

Smaller surface per window = smaller attack surface; the minimal bundle
cannot even reach canvas/model code paths (defense in depth, ADR-0145).

## Accessibility implications

Theme/token sync (light/dark/high-contrast) must match the primary; the
auxiliary window subscribes to the theme slice of the session snapshot.

## Performance implications

Measured budgets (M6 milestone gate): empty auxiliary window memory,
per-panel incremental memory, idle/minimized CPU, creation/hydration
latency — recorded in `docs/quality/perf-budgets.md` before M7 proceeds.

## Rejected shortcuts

Lazy-loading nothing (full bundle per window); sharing WebGL contexts
across windows (not possible); duplicating model workers per window.
