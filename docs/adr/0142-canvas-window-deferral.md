# ADR-0142: Canvas-window deferral

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

The spec explicitly forbids making the canvas detachable before panel-only
windows are reliable. The canvas is deeply single-window-coupled: document-
global viewport math via `document.querySelector('.editor-canvas')`
(`context.tsx:3527,3541`, `context/viewportOps.ts:59-67`), window-global
pointer pipeline (`canvas/inputPipeline.ts:593`), and a per-window renderer
stack.

## Alternatives

1. Detach canvas early (rejected — viewport/selection/tool ownership
   problems; violates the program's phased rule).
2. Treat every canvas surface as a `DocumentView` in a later phase
   (chosen for roadmap).

## Decision

- **Not part of MVP:** detachable canvases, independent document windows,
  cross-process rendering, arbitrary plugin windows, always-on-top
  palettes, window transparency, floating toolbars outside app windows.
- Roadmap entry (post-M11): a second canvas view requires per-view
  viewport/zoom/pan/rulers/overlays/pointer state/active page, selection
  policy, tool ownership, text-edit ownership, GPU/renderer resource
  budgets, worker scheduling, dirty-region routing, and export isolation —
  each item landing as its own milestone with benchmarks.
- A canvas surface is a `DocumentView`, never a panel (ADR-0124
  registry `capabilities.requiresCanvas` marks canvas surfaces
  `allowedHosts: ['primary-sidebar']` only).
- Prevent the same text node entering incompatible edit modes in two
  views (text-edit ownership is a broker-routed session state when the
  phase lands).

## Consequences

- MVP scope stays achievable: panel windows need no renderer, no GPU, no
  pointer pipeline.
- The `DocumentView` concept is reserved now so later canvas windows do
  not reshape the session model.

## Migration impact

None; deferral is a scoping decision.

## Cross-platform implications

Deferred canvas windows will carry the heaviest cross-platform burden
(WebKitGTK vs WebView2 vs WKWebView rendering); deferral keeps MVP
cross-platform risk low.

## Security implications

None beyond existing.

## Accessibility implications

None beyond existing.

## Performance implications

MVP panel windows initialize no canvas systems (ADR-0143) — the largest
single memory win of the program.

## Rejected shortcuts

Attaching the canvas to an auxiliary window; duplicating the renderer per
window; treating a canvas as a panel type.
