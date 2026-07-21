import type { ActionTracker } from './actionTracker';

const ADVANCED_FEATURES = new Set([
  'booleanUnion',
  'booleanSubtract',
  'group',
  'alignLeft',
  'variables',
  'stateMachine',
  'prototype',
]);

const WINDOW_30_DAYS = 30 * 24 * 60 * 60 * 1000;

export type ComplexityLevel = 'beginner' | 'intermediate' | 'advanced';

export interface ComplexityConfig {
  level: ComplexityLevel;
  hiddenSections: string[];
  hiddenFeatures: string[];
}

function countActions(tracker: ActionTracker): number {
  return tracker.getRecentActions(WINDOW_30_DAYS).length;
}

function countAdvancedFeatures(tracker: ActionTracker): number {
  const recent = tracker.getRecentActions(WINDOW_30_DAYS);
  let count = 0;
  for (const r of recent) {
    if (ADVANCED_FEATURES.has(r.actionId)) {
      count++;
    }
  }
  return count;
}

export function getComplexityLevel(tracker: ActionTracker): ComplexityLevel {
  const totalActions = countActions(tracker);
  const advancedCount = countAdvancedFeatures(tracker);

  if (totalActions > 100 || advancedCount >= 3) {
    return 'advanced';
  }

  if (totalActions >= 20 || advancedCount >= 1) {
    return 'intermediate';
  }

  return 'beginner';
}

export function getComplexityConfig(tracker: ActionTracker): ComplexityConfig {
  const level = getComplexityLevel(tracker);

  switch (level) {
    case 'beginner':
      return {
        level,
        hiddenSections: ['effects', 'blendModes', 'variables', 'prototype', 'stateMachines'],
        hiddenFeatures: [],
      };
    case 'intermediate':
      return {
        level,
        hiddenSections: ['stateMachines'],
        hiddenFeatures: [],
      };
    case 'advanced':
      return {
        level,
        hiddenSections: [],
        hiddenFeatures: [],
      };
  }
}
