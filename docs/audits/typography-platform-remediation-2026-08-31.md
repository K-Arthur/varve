# Typography platform remediation audit — 2026-08-31

Status: active remediation. This audit records the verified editor failure
mode, the first corrective slice, and the remaining platform work so product
claims stay aligned with runtime behavior.

## Confirmed failure causes

1. The text editor was a transparent `<textarea>` over a canvas text node. The
   browser accepted input, but the user-facing glyphs and selection feedback
   were delayed or absent until a later canvas render.
2. Any blur committed the edit. The floating formatting bar is portaled, so
   clicking a font or weight control looked like leaving the editor and ended
   the session before the control could apply its change.
3. The font registry already had a revision/subscriber mechanism, but selector
   and browser consumers memoized family lists without subscribing to it.
4. Multiple font selectors used hard-coded listbox and option IDs, producing
   invalid ARIA relationships when the inspector and floating bar were mounted
   together.
5. Online selection changed the node before the download/load/store pipeline
   completed. Search errors were provider-specific transport text, and one
   failed provider could erase another provider's successful results.
6. The public demo had no remote font capability contract. Allowing a live
   provider path there would contradict its local-first CSP and product
   boundary.

## Implemented in this remediation slice

- The DOM editor is visibly rendered with the node's managed fill color and is
  marked as an editing surface.
- Blur commits are deferred one animation frame and ignored when focus moves to
  the editor, formatting overlay, inspector, or another declared overlay.
  Commit is idempotent and cleanup cancels the pending blur task.
- The redraw coordinator tracks the active text target. Target transitions
  force a full redraw; the renderer omits the active node and does not reuse a
  worker bitmap while the DOM surface owns it.
- FontSelector subscribes to `FontRegistry` revisions, uses instance-unique
  combobox/listbox/option IDs, and waits for successful online installation
  before applying a family.
- Provider search runs concurrently with stale-request protection and retains
  successful results when its peer provider fails. User-facing errors are
  normalized.
- `onlineFonts` is a capability restriction in the browser demo. Desktop CSP
  explicitly includes Fontsource metadata/CDN origins; the demo CSP remains
  local-only.
- Repeated identical registry entries are ignored while distinct source
  entries remain available for provenance and fallback decisions.
- Runtime discovery now uses the shipped Fontsource and semantic catalogs;
  metadata search is local, installation is explicit and version-pinned, and
  the legacy Google provider is disabled.
- The missing-font dialog resolves exact catalog identities and requested
  faces, displays license metadata, respects the browser-demo restriction, and
  opens the full browser for alternatives without removing local replacement.
- Downloaded and restored Fontsource artifacts retain provider, weight, and
  style identity. WOFF2 decompressor initialization is bounded so installation
  cannot remain permanently pending in a browser or native webview.

## Remaining work / explicit follow-up

- Carry exact parsed face identity (content hash, PostScript name, collection
  index, axes, and embedding rights) through `FontEntry`, `FontLoader`, the
  download manager, IndexedDB, and Tauri filesystem storage. Family name alone
  is not an identity key.
- Add redirect-host, content-signature, face-identity, and persisted-byte
  verification tests at the download boundary.
- Extend real-browser coverage from the passing active-editing, exact
  Fontsource recovery, and public-demo capability cases to installation
  failure and retry behavior.
- Verify accessibility with screen reader announcements, IME composition,
  bidi text, and keyboard-only toolbar navigation in Chromium and at least one
  native webview.

## Validation evidence

- Focused editor/engine Vitest: 5 files, 102 tests passed.
- Editor and engine package typechecks passed before the redraw-boundary slice;
  the redraw-boundary typecheck is being rerun after this audit update.
- Existing real-browser typography visual suite:
  `font-readiness-and-multiline.spec.ts` — 5 passed. Reviewed screenshots for
  soft-wrapped area text, multiline editing selection, and try-font rendering.
- New active-editing E2E could not boot because the current shared worktree
  contains a concurrent `ToastProvider` edit that Vite cannot resolve. No
  unrelated file was reverted to bypass that blocker.
