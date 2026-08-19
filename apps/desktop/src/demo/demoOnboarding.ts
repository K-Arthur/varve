/**
 * Keep the first-run onboarding dialog out of the browser demo.
 *
 * The demo seeds a sample poster precisely so a visitor can interact with a
 * real design immediately. The editor's first-run flow defeats that: because
 * every demo visitor is by definition a first-time user, `showWelcome` is
 * always true, so a modal covers the sample document on every single load and
 * offers "Take the tour", "Start with a template", and "Blank canvas" —
 * the last of which would throw the sample away before it was ever seen.
 *
 * The demo does its own explaining through DemoBanner, so the onboarding state
 * is marked complete before the editor mounts. This only touches the demo
 * origin's storage; desktop and the ordinary web build keep their first run.
 */

import {
  CHECKLIST_ITEMS,
  loadOnboardingState,
  markOnboardingComplete,
  saveOnboardingState,
} from '@varve/editor';

export function suppressFirstRunOnboarding(): void {
  try {
    const state = loadOnboardingState();
    if (state.onboardingComplete) return;
    // The "Getting started" checklist re-opens whenever any item is still
    // outstanding — completing the tour alone is not enough to keep it off a
    // demo visitor's canvas, so pre-fill its progress as well.
    saveOnboardingState({
      ...markOnboardingComplete(state),
      checklistProgress: CHECKLIST_ITEMS.map((item) => item.id),
    });
  } catch {
    // localStorage throws in strict privacy modes. The dialog reappearing is a
    // cosmetic problem, not a reason to fail the boot.
  }
}
