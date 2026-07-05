const STORAGE_KEY = 'strata:onboarding';
const CURRENT_VERSION = 1;

export interface OnboardingStore {
  onboardingComplete: boolean;
  onboardingVersion: number;
  skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'unclassified';
  checklistProgress: string[];
  dismissedTips: string[];
  seenFeatureBadges: string[];
  tutorialFileCompleted: boolean;
}

const DEFAULT_STATE: OnboardingStore = {
  onboardingComplete: false,
  onboardingVersion: 0,
  skillLevel: 'unclassified',
  checklistProgress: [],
  dismissedTips: [],
  seenFeatureBadges: [],
  tutorialFileCompleted: false,
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

export function saveOnboardingState(state: OnboardingStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetOnboarding(): void {
  saveOnboardingState({ ...DEFAULT_STATE });
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

export function listenForStorageChanges(onChange: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      onChange();
    }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
