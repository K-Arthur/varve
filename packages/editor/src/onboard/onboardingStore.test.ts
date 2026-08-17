/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkChecklistItem,
  dismissTip,
  getCurrentVersion,
  isVersionBump,
  loadOnboardingState,
  markOnboardingComplete,
  markTutorialComplete,
  type OnboardingStore,
  resetOnboarding,
  saveOnboardingState,
  seeFeatureBadge,
} from './onboardingStore';

describe('onboardingStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default state when no stored data', () => {
    const state = loadOnboardingState();
    expect(state.onboardingComplete).toBe(false);
    expect(state.skillLevel).toBe('unclassified');
    expect(state.checklistProgress).toEqual([]);
    expect(state.dismissedTips).toEqual([]);
  });

  it('save / load round-trip preserves all fields', () => {
    const state: OnboardingStore = {
      onboardingComplete: true,
      onboardingVersion: 1,
      skillLevel: 'intermediate',
      checklistProgress: ['shape', 'color'],
      dismissedTips: ['tip1'],
      seenFeatureBadges: ['tool:pen'],
      tutorialFileCompleted: true,
      dismissedMicroHints: ['rect.first-use'],
      lastSeenReleaseVersion: '0.8.0',
    };
    saveOnboardingState(state);
    const loaded = loadOnboardingState();
    expect(loaded).toEqual(state);
  });

  it('resetOnboarding clears all fields', () => {
    const state: OnboardingStore = {
      onboardingComplete: true,
      onboardingVersion: 1,
      skillLevel: 'advanced',
      checklistProgress: ['shape'],
      dismissedTips: ['tip1'],
      seenFeatureBadges: ['tool:pen'],
      tutorialFileCompleted: true,
      dismissedMicroHints: ['rect.first-use'],
      lastSeenReleaseVersion: '0.8.0',
    };
    saveOnboardingState(state);
    resetOnboarding();
    const loaded = loadOnboardingState();
    expect(loaded.onboardingComplete).toBe(false);
    expect(loaded.skillLevel).toBe('unclassified');
    expect(loaded.dismissedMicroHints).toEqual([]);
  });

  it('handles corrupted JSON gracefully', () => {
    localStorage.setItem('strata:onboarding', 'not-json');
    const state = loadOnboardingState();
    expect(state.onboardingComplete).toBe(false);
    expect(state.skillLevel).toBe('unclassified');
  });

  it('isVersionBump detects version changes', () => {
    const old: OnboardingStore = {
      onboardingComplete: true,
      onboardingVersion: 0,
      skillLevel: 'beginner',
      checklistProgress: [],
      dismissedTips: [],
      seenFeatureBadges: [],
      tutorialFileCompleted: false,
    };
    expect(isVersionBump(old)).toBe(true);
    const current: OnboardingStore = { ...old, onboardingVersion: getCurrentVersion() };
    expect(isVersionBump(current)).toBe(false);
  });

  it('markOnboardingComplete sets version', () => {
    const s = loadOnboardingState();
    const updated = markOnboardingComplete(s);
    expect(updated.onboardingComplete).toBe(true);
    expect(updated.onboardingVersion).toBe(getCurrentVersion());
  });

  it('dismissTip adds tip to dismissed set', () => {
    const s = loadOnboardingState();
    const updated = dismissTip(s, 'tip-shortcuts');
    expect(updated.dismissedTips).toContain('tip-shortcuts');
  });

  it('dismissTip is idempotent', () => {
    const s = dismissTip(loadOnboardingState(), 'tip-a');
    const s2 = dismissTip(s, 'tip-a');
    expect(s2.dismissedTips.length).toBe(1);
  });

  it('checkChecklistItem adds item to progress', () => {
    const s = loadOnboardingState();
    const updated = checkChecklistItem(s, 'shape');
    expect(updated.checklistProgress).toContain('shape');
    expect(updated.checklistProgress.length).toBe(1);
  });

  it('checkChecklistItem is idempotent', () => {
    const s = checkChecklistItem(loadOnboardingState(), 'item');
    const s2 = checkChecklistItem(s, 'item');
    expect(s2.checklistProgress.length).toBe(1);
  });

  it('markTutorialComplete sets flag', () => {
    const s = markTutorialComplete(loadOnboardingState());
    expect(s.tutorialFileCompleted).toBe(true);
  });

  it('seeFeatureBadge adds to seen badges', () => {
    const s = seeFeatureBadge(loadOnboardingState(), 'tool:pen');
    expect(s.seenFeatureBadges).toContain('tool:pen');
  });
});
