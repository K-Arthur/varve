# Onboarding and Help System

Architecture for first-run guidance, contextual help, and the offline help corpus in Strata.

## Design constraints (offline-first, dual-target)

| Constraint | Resolution |
|---|---|
| **Offline help** | All in-app articles live in bundled TypeScript (`@strata/help` + editor-local tool/panel articles). No network fetch for search or articles. |
| **No accounts** | Onboarding state is per-device only. No cloud profile or cross-device sync. |
| **Desktop persistence** | Full `OnboardingStore` JSON is written to platform app settings (SQLite via Tauri on desktop, IndexedDB KV on web) on every save — not only on dismiss. |
| **Browser persistence** | Same platform path; `localStorage` is a fast cache that may be cleared independently (private mode, site data wipe). Platform storage is authoritative on hydrate. |
| **External links** | In-app help has no external URLs today. Settings About links are stubs; when added, desktop must use `tauri-plugin-opener`, browser uses `target="_blank"`. |
| **Analytics** | None sent remotely. `ActionTracker` and help feedback are `localStorage` only. |

## User-facing entry points

| Entry | Shortcut / path | UI |
|---|---|---|
| **Welcome dialog** | First launch (`onboardingComplete: false`) | Modal with tour / template / blank |
| **Spotlight tour** | Welcome → tour, or Help → Take a tour | `SpotlightOverlay` coachmarks |
| **Getting started checklist** | After welcome dismissed | Floating checklist |
| **Did You Know tips** | Idle-triggered, max 5/day | Toast card |
| **Contextual help** | `F1`, Help → Contextual help | Right-side `ContextualHelpPanel` |
| **Help center** | `Ctrl+Shift+F1`, Help → Help center | `HelpBrowser` modal (full corpus) |
| **What's This?** | `Shift+F1`, Help → What's this? | Click-to-learn overlay |
| **Reset onboarding** | Settings → General → Reset onboarding | Clears state + re-shows welcome |

## Content architecture

```
packages/help/src/content/*.ts     # Getting Started, FAQ, Troubleshooting, Shortcuts
packages/editor/src/onboard/ContextualHelp/helpContent.ts  # tool:* / panel:* articles
packages/editor/src/onboard/DidYouKnow/tips.ts             # conditional tips
packages/editor/src/components/Onboarding/tourSteps.ts     # tour copy
packages/editor/src/samples/tutorial-document.ts           # bundled tutorial doc
```

Articles are plain strings versioned with the app. Update copy in the same PR as UI changes that affect screenshots or selectors.

**Tour anchoring:** `SpotlightOverlay` uses CSS selectors. Missing targets show a non-blocking status message and the tour continues — it does not crash.

## State model

`OnboardingStore` (`packages/editor/src/onboard/onboardingStore.ts`):

- `onboardingComplete`, `onboardingVersion`
- `checklistProgress`, `dismissedTips`, `seenFeatureBadges`
- `tutorialFileCompleted`, `skillLevel` (reserved; classifier not wired)

Persistence keys:

- `localStorage`: `strata:onboarding`
- Platform app setting: `onboarding` (full JSON)

## Key modules

| Module | Role |
|---|---|
| `useOnboarding` | Welcome + tour state, platform hydrate |
| `useEditorHelp` | F1 contextual help, help center, Shift+F1 What's This |
| `ContextualHelpPanel` | Side panel search + articles |
| `WhatIsThis` | Click-to-learn mode |
| `HelpBrowser` | Full help center modal |
| `useDidYouKnow` | Idle tips from `ActionTracker` |

## Adding help content

1. **Tool article:** add `tool:<toolId>` to `LOCAL_HELP_CONTENT` in `helpContent.ts`.
2. **Panel article:** add `panel:<name>` and `data-panel="<name>"` on the panel root in `Shell.tsx`.
3. **General article:** add to `packages/help/src/content/*.ts`.
4. **Tour step:** add to `tourSteps.ts` with a stable CSS selector; verify in Playwright if possible.

No rebuild pipeline beyond TypeScript — content is imported at compile time.

## Accessibility

- WCAG 2.2 AA target (matches repo token audit).
- Tour: `role="dialog"`, `aria-modal`, Escape to dismiss, arrow keys for steps.
- Contextual panel: `role="complementary"`, labelled search, Escape to close.
- What's This: `aria-live` announcement on enter; Escape to exit.
- `prefers-reduced-motion`: tour/coachmark animations disabled via CSS.

## Testing

- Unit: `packages/editor/src/onboard/**/*.test.ts`
- Integration: `ShellHelp.integration.test.tsx` (F1, Ctrl+Shift+F1, Shift+F1)
- E2E: `tests/e2e/canvas/onboarding-help.spec.ts`

## Deferred (lower priority)

| Item | Severity | Rationale |
|---|---|---|
| `onboardingAdapter` skill-based flow branching | Medium | Classifier exists but not wired; beginner/intermediate paths need product decision |
| `NewFeatureBadge` on toolbar | Low | Component tested but not mounted; version-bump UX needs design |
| Version-bump re-onboarding modal | Medium | `isVersionBump()` exists; no UI trigger on app update |
| Localized help (i18n) | Medium | Language setting is English-only stub |
| Tauri native Help menu | Low | Uses in-webview menubar today |
| Website docs integration | Low | `apps/website` is separate static site, not loaded in-editor |

## Research basis

Patterns adapted from offline-first tools (Affinity welcome hub + bundled help, Sketch command bar) rather than cloud-only Discover panels (Adobe/Figma) that require connectivity. See assignment research notes in session final report.
