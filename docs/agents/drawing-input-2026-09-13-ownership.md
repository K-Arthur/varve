# Drawing input / stylus improvement ownership

**Task:** `drawing-input-2026-09-13`
**Coordinator:** Codex
**Started:** 2026-09-13
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per the
user instruction; no branch or worktree was created)
**Initial repository base:** `806522cf1`

## Scope

This work owns the canonical pointer normalization, pointer ownership policy,
Pen/Pencil lifecycle repairs, persisted drawing-input preferences, their focused
tests, browser-engine regression coverage, and the associated current-state
documentation/website claims.

It deliberately does not own `CanvasArea.tsx`, `Shell.tsx`, `context.tsx`, the
render-worker/compositor, packaging, or the responsive layout work already
recorded by the ChromeOS Stage 4 owner. The canvas adapter is changed through
the existing `inputPipeline.ts` boundary; no parallel input handler is added.
Linux ARM64 packaging and Crostini installation remain with the Stage 5 owner.

## Shared-file coordination

| Surface | Owner / status | Coordination rule |
|---|---|---|
| `packages/editor/src/canvas/inputPipeline.ts` | This task | Reuse the existing adapter; preserve wheel/trackpad paths and navigation state. |
| `packages/editor/src/tools/inputNormalizer.ts` | This task | Canonical source for normalized samples; no tool-local pointer decoding. |
| `PenTool`, `PencilTool`, `PaintTool` | This task | Pointer identity and transaction semantics remain per tool. |
| `packages/editor/src/settings.ts` and Settings dialog | This task | One persisted `drawingInput` section; runtime cache is only a read-through optimization. |
| `CanvasArea.tsx`, `Shell.tsx`, `context.tsx` | Hub owner / untouched | No new imports or responsibilities added. |
| ChromeOS Stage 4 docs/website | Existing owner | Re-read before edits; changes here are limited to reconciled input claims. |
| Crostini/Linux packaging | Existing Stage 5 owner | No package or dependency claims are invented here. |

The worktree was already dirty and had active validation processes from other
agents. Existing changes are preserved; commits use explicit path lists and do
not include unrelated staged or untracked files.

## Research refresh (accessed 2026-09-13)

The full source ledger, decisions, and uncertainties are in
[`drawing-input-quality-audit-2026-09-13.md`](../audits/drawing-input-quality-audit-2026-09-13.md).
The relevant refresh covered Pointer Events Level 3, MDN pointer/pressure/
touch-action/multitouch guidance, Chrome low-latency canvas notes, ChromeOS
touch and stylus help, Lenovo's Duet 11M889 specification, Tauri's Linux
WebView boundary, Playwright's emulation limits, WCAG target/dragging guidance,
and public issue reports describing touch/pen failures in other drawing tools.

## Validation status

Synthetic unit and policy tests are passing. The first isolated Chromium E2E
attempt was stopped after the shared machine kept it waiting for the home
screen while another E2E/validation job was active; this is recorded as an
environment limitation, not a product pass or fail. A quiet-port run and visual
inspection are required before completion. Physical Lenovo Duet, USI Pen 2,
PWA, and Crostini runs remain manual validation items unless hardware becomes
available.
