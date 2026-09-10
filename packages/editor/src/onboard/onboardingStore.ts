import type { Platform } from '@varve/platform';

const STORAGE_KEY = 'strata:onboarding';
const APP_SETTING_KEY = 'onboarding';
const CURRENT_VERSION = 1;

export interface OnboardingStore {
  onboardingComplete: boolean;
  onboardingVersion: number;
  checklistProgress: string[];
  dismissedTips: string[];
  seenFeatureBadges: string[];
  tutorialFileCompleted: boolean;
  /** IDs of contextual micro-hints the user has seen or dismissed. */
  dismissedMicroHints: string[];
  /** Last Varve version the user saw release notes for. */
  lastSeenReleaseVersion: string;
}

const DEFAULT_STATE: OnboardingStore = {
  onboardingComplete: false,
  onboardingVersion: 0,
  checklistProgress: [],
  dismissedTips: [],
  seenFeatureBadges: [],
  tutorialFileCompleted: false,
  dismissedMicroHints: [],
  lastSeenReleaseVersion: '',
};

export function loadOnboardingState(): OnboardingStore {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(stored);
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveOnboardingState(state: OnboardingStore, platform?: Platform): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (platform) {
    void saveOnboardingStateToPlatform(platform, state);
  }
}

/**
 * Read onboarding state from native platform storage (SQLite on desktop,
 * IndexedDB on web) rather than raw localStorage, which is not guaranteed to
 * survive between separate app launches on every WebView engine (observed
 * on Linux/WebKitGTK: the welcome dialog reappearing every launch despite
 * `saveOnboardingState` succeeding within the session). Returns null if
 * nothing has been persisted yet or the read fails.
 */
export async function loadOnboardingStateFromPlatform(
  platform: Platform,
): Promise<OnboardingStore | null> {
  try {
    const raw = await platform.getAppSetting(APP_SETTING_KEY);
    if (!raw) return null;
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

export async function saveOnboardingStateToPlatform(
  platform: Platform,
  state: OnboardingStore,
): Promise<void> {
  try {
    await platform.setAppSetting(APP_SETTING_KEY, JSON.stringify(state));
  } catch {
    // IPC/storage failure — localStorage still holds a same-session copy.
  }
}

export async function clearOnboardingFromPlatform(platform: Platform): Promise<void> {
  try {
    await platform.setAppSetting(APP_SETTING_KEY, '');
  } catch {
    // Best-effort — localStorage reset still applies.
  }
}

export function resetOnboarding(platform?: Platform): void {
  saveOnboardingState({ ...DEFAULT_STATE }, platform);
  if (platform) {
    void clearOnboardingFromPlatform(platform);
  }
}

export function isVersionBump(state: OnboardingStore): boolean {
  return state.onboardingVersion < CURRENT_VERSION;
}

export function getCurrentVersion(): number {
  return CURRENT_VERSION;
}

export function markOnboardingComplete(state: OnboardingStore): OnboardingStore {
  return {
    ...state,
    onboardingComplete: true,
    onboardingVersion: CURRENT_VERSION,
  };
}

export function dismissTip(state: OnboardingStore, tipId: string): OnboardingStore {
  if (state.dismissedTips.includes(tipId)) return state;
  return { ...state, dismissedTips: [...state.dismissedTips, tipId] };
}

export function checkChecklistItem(state: OnboardingStore, itemId: string): OnboardingStore {
  if (state.checklistProgress.includes(itemId)) return state;
  return { ...state, checklistProgress: [...state.checklistProgress, itemId] };
}

export function markTutorialComplete(state: OnboardingStore): OnboardingStore {
  return { ...state, tutorialFileCompleted: true };
}

export function seeFeatureBadge(state: OnboardingStore, featureId: string): OnboardingStore {
  if (state.seenFeatureBadges.includes(featureId)) return state;
  return { ...state, seenFeatureBadges: [...state.seenFeatureBadges, featureId] };
}

export function dismissMicroHint(state: OnboardingStore, hintId: string): OnboardingStore {
  if (state.dismissedMicroHints.includes(hintId)) return state;
  return { ...state, dismissedMicroHints: [...state.dismissedMicroHints, hintId] };
}

export function hasSeenMicroHint(state: OnboardingStore, hintId: string): boolean {
  return state.dismissedMicroHints.includes(hintId);
}

export function markReleaseSeen(state: OnboardingStore, version: string): OnboardingStore {
  return { ...state, lastSeenReleaseVersion: version };
}

export function listenForStorageChanges(onChange: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      onChange();
    }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
