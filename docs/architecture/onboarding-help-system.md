# Onboarding & Help System Architecture

## Offline-First (Section 0 Resolution)

- **Accounts/auth**: None. No cloud sync. The app is fully local-first. onboarding must never include "sign up / verify email / invite team" steps.
- **Help content**: Bundled as TypeScript modules. No network requests. The `@strata/help` package contains ~30 articles; `packages/editor/src/onboard/ContextualHelp/` has 30+ tool/panel articles. Both are statically imported — works fully offline.
- **Analytics/telemetry**: None. The ActionTracker (`packages/editor/src/intelligence/actionTracker.ts`) records local user actions to localStorage only — never sent anywhere. Onboarding features must not add external analytics SDKs.
- **Dual-target persistence**: Onboarding state persists to both `localStorage` (fast, same-session) and `Platform.getAppSetting/setAppSetting` (SQLite on Tauri, IndexedDB on web). The second layer corrects for WebView localStorage being cleared between launches (common on WebKitGTK). After a storage-clear event, the welcome dialog re-appears — this is acceptable degradation (onboarding is harmless to re-show).
- **External links**: `tauri-plugin-opener` is registered but unused. Help content currently has no external URLs — all help is bundled. If external links are added later, use `window.open` in browser and `tauri-plugin-opener` on desktop.

## Help Content Architecture

Two help content registries, now merged:
1. **`@strata/help`** (`packages/help/src/content/`) — F1 Help Browser. Categories: Getting Started, Tools, Panels, Export, Shortcuts, FAQ, Troubleshooting. ~30 articles. Each article has: id, title, summary, body, keywords[], category, related[].
2. **ContextualHelp** (`packages/editor/src/onboard/ContextualHelp/helpContent.ts`) — slide-out help panel. Tool/panel-specific articles for What's This mode. Now imports and merges `@strata/help` content so all entry points search the full corpus.

Both use `HelpArticle` interface with same shape; both are statically bundled TypeScript.

## Content Addition Guide

### Adding a help article
1. Add to `packages/help/src/content/<category>.ts` (for F1 browser) or
2. Add to `packages/editor/src/onboard/ContextualHelp/helpContent.ts` (for What's This mode)
3. If adding to both, IDs must not collide (use `tool:`, `panel:`, `getting-started:`, `faq:`, etc. prefixes)

### Adding a tour step
1. Add entry to `packages/editor/src/components/Onboarding/tourSteps.ts`
2. Use specific CSS selectors (prefer `data-*` attributes or semantic selectors over fragile `[class*="..."]` patterns)
3. Test that the tour step target exists in the DOM when the step runs

### Adding a Did You Know tip
1. Add entry to `packages/editor/src/onboard/DidYouKnow/tips.ts`
2. Set `condition` function to query action tracker for relevance

### Adding data attributes for What's This mode
- Tool buttons: add `data-tool={toolId}` attribute
- Panels: add `data-panel={panelName}` attribute (e.g. `data-panel="layers"`)
- Update `TOOL_HELP_MAP` in `packages/editor/src/onboard/WhatIsThis/WhatIsThis.tsx`

## State persistence

- **`OnboardingStore`** (`packages/editor/src/onboard/onboardingStore.ts`): tracks `onboardingComplete`, `version`, `skillLevel`, `checklistProgress[]`, `dismissedTips[]`, `seenFeatureBadges[]`, `tutorialFileCompleted`.
- Dual write: `localStorage` (synchronous, fast) + `Platform` storage (async, survives WebView resets).
- `useOnboarding` hook reads localStorage first for fast first paint, then corrects from platform storage.

## Entry points

| Trigger | What opens | Source |
|---------|-----------|--------|
| First launch | `WelcomeDialog` | `packages/editor/src/components/Onboarding/` |
| "Take the tour" | `SpotlightOverlay` (6 steps) | `packages/editor/src/components/Onboarding/` |
| Welcome dismiss | `OnboardingChecklist` (auto-shown) | `packages/editor/src/onboard/OnboardingChecklist/` |
| 15s idle | `DidYouKnowTip` (contextual) | `packages/editor/src/onboard/DidYouKnow/` |
| F1 | `HelpBrowser` (dialog) | `packages/help/src/` |
| ? | `ShortcutPalette` | `packages/editor/src/shortcuts/` |
| Shift+F1 | What's This mode | `packages/editor/src/onboard/WhatIsThis/` |
| Ctrl+Shift+P | `ShortcutPalette` | `packages/editor/src/shortcuts/` |
