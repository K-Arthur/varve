# Offline-First UX — canonical contract

Varve is a **local-first design application**: documents, edits, undo history,
fonts, and the full editing toolset work with no connection. This document
defines what "offline" means in the UI and what the app must never pretend.

Status: enforced contract, 2026-08-13.

## The contract

1. **Nothing essential requires a network.** Creating, editing, saving,
   reopening, undoing, printing, and exporting all work offline. The app must
   remain fully usable with the network stack severed.
2. **The offline indicator tells the truth.** The `OfflineBanner` (mounted in
   the menubar, `components/OfflineBanner.tsx`) appears only when
   `navigator.onLine` flips false and says what offline *actually* changes:
   remote font providers (Google Fonts, Fontsource), icon providers, and
   optional model downloads are unavailable. It must never imply that
   documents are at risk or that a "sync" is pending — local-first products
   have no pending sync, and promising one is a lie.
3. **No fake model surfaces.** Varve has no cloud LLM. The "Design Assistant"
   (`components/AIPanel.tsx`, mounted as the Assistant tab of the Resources
   panel) is an on-device command surface: every intent dispatches to a real
   deterministic heuristic command (`@varve/ai` `dispatchIntelligence` —
   contrast audit, debt scan, layer naming, spacing harmonization), and
   unknown intents get an honest reply listing the commands that exist.
   Canned personality replies, simulated latency, fake model selectors, and
   dead Apply/Preview buttons are prohibited. The Settings "On-device
   Assistants" section states this; analytics/diagnostics consent lives in
   Privacy.
4. **AI features are on-device or opt-in downloads.** Background removal,
  upscaling, and image tracing run bundled ONNX models or the native engine
  (ADR-0005); remote downloads are explicit user actions with a progress
  surface, never implicit.
   Visual-awareness analysis follows the same rule: importing an image does not
   trigger face, hand, pose, object, or segmentation analysis. A future
   workflow requests one explicit capability and may download only its verified
   task model after user action.
5. **Saving is local disk, always.** `autoSaveService` + platform persistence
   never depend on reachability. The only network-dependent saves would be
   explicit cloud features, none of which exist yet.

## What the user sees

| Surface | Online | Offline |
|---|---|---|
| Editing tools, canvas, inspector | normal | identical |
| Save / autosave / history | normal | identical |
| Font browser | local fonts + online search | local fonts only |
| Icon browser | providers + cache | cached/installed packs only |
| Design Assistant | on-device commands | identical (no network used) |
| Banner | hidden | "Offline — your document and all tools keep working locally. Online font and icon search is unavailable." |

## Prohibitions (regressions on any of these are bugs)

- An offline banner or dialog claiming unsaved changes are at risk while
  saving locally.
- A chat surface that answers with canned "assistant" personality text or
  artificial delay when a real command exists or the intent is unknown.
- Settings controls that reference cloud models, API keys, or model
  selectors that nothing consumes.
- Any network call in the normal edit/save path.

## Verification

- E2E: `tests/e2e/canvas/offline-first.spec.ts` (devtools offline emulation:
  create → edit → save → reopen with the network severed; assistant replies
  still work; banner appears).
- Unit: `OfflineBanner.test.tsx` (appearance, dismiss, honest copy),
  `AIPanel.test.tsx` (real dispatch, honest fallback, no dead buttons),
  `@varve/ai` `index.test.ts` (no simulated latency).
