# Loading Experience Audit — Strata

| Area | Existing State | Actual Latency | Current Feedback | Necessary? | Better Pattern | Performance Problem? |
| ---- | -------------- | -------------: | ---------------- | ---------- | -------------- | -------------------- |
| App Startup | No gate; immediate mount | 300–800ms (IDB/Tauri init) | None (white screen) | Yes | Branded Startup Loader | No |
| Document Open | Sync mount in `App.tsx` | 50–200ms (local JSON read) | None (immediate UI flip) | Yes | Contextual Region Loader | No |
| Export | `ExportProgressBar.tsx` | 500ms–10s+ (rendering) | determinate progress | Yes | Consolidated Determinate primitive | No |
| Background Removal | `ModelDownloadDialog.tsx` | 5s–30s (network) | custom modal progress | Yes | Consolidated Determinate primitive | No |
| BgRemoval Settings | `BgRemovalModelsTab.tsx` | 200–500ms (IDB/Engine) | "Loading model status..." text | Yes | Region Loader / Skeleton | No |
| AI Assistant | `AIPanel.tsx` | 1s–5s (remote API) | 3-dot typing animation | Yes | Contextual Region Loader / Typing state | No |
| Activity Feed | `ActivityFeed.tsx` | 100–300ms (IDB) | `LoaderCircle` icon + text | Yes | Inline Activity / Region Loader | No |
| Thumbnails | `useThumbnailLoader.ts` | 50ms–1s (render/read) | None visible (blank slot) | Yes | Skeleton / Progressive Image | No |
| Button Actions | `Button.tsx` `loading` prop | varies | Inline spinner icon | Yes | `InlineActivityIndicator` | No |
| Image Placing | `clipboard.ts` | 50–200ms (blob/decode) | None | No | No loader (immediate feedback) | No |
| Font Discovery | `FontRegistry` | 100–300ms (system call) | None | No | No loader (lazy background) | No |

## Research Findings
- **Thresholds:** <100ms is perceived as instant. 100–300ms needs a subtle state change. >1s needs a loader. >10s needs determinate progress + cancellation.
- **Competitor Patterns:**
  - **Figma:** Uses a branded splash screen for startup; skeletons for files; inline activity for shared collab.
  - **Adobe:** Splash screen for native startup; "Preparing..." modals for heavy exports.
  - **Affinity:** native startup splash; progress bar in status bar for background tasks.
- **Anti-patterns found in Strata:**
  - Ad-hoc "Loading..." text strings scattered in `ActivityFeed`, `BgRemovalModelsTab`.
  - Multiple spinner implementations (Button, ActivityFeed).
  - No visual feedback during app boot (white screen before HomeShell).

## Identified Performance Problems
- **Startup:** Currently mounts everything immediately. If `useHomeView` takes long, the user sees an empty Shell state before data pops in.
- **Export/Import:** Custom implementations for progress bars are inconsistent.
- **Model Downloads:** Modal-only progress blocks the whole app for a background-capable task.

## Accessibility Gap Analysis
- Some loaders use `aria-busy`, others use `role="status"`.
- No reduced-motion support for spinners.
- Contrast of current `strata-btn__spinner` needs verification.

---
*Audit Date: 2026-07-08*
