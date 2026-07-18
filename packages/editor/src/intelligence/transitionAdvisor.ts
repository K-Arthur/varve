export interface TimingSuggestion {
  duration: number;
  reason: string;
}

const TRANSITION_RANGES: Record<string, { min: number; max: number; reason: string }> = {
  instant: { min: 0, max: 0, reason: 'Instant transitions have no duration' },
  dissolve: { min: 250, max: 350, reason: 'Dissolve transitions work well between 250-350ms' },
  slide: { min: 300, max: 500, reason: 'Slide transitions need 300-500ms for natural motion' },
  push: { min: 300, max: 500, reason: 'Push transitions need 300-500ms for natural motion' },
  moveIn: { min: 300, max: 500, reason: 'Move transitions need 300-500ms for natural motion' },
  moveOut: { min: 300, max: 500, reason: 'Move transitions need 300-500ms for natural motion' },
  smartAnimate: {
    min: 300,
    max: 500,
    reason: 'Smart Animate needs 300-500ms for smooth interpolation',
  },
};

function defaultRange(kind: string) {
  return { min: 300, max: 500, reason: `Default range for ${kind} transitions` };
}

function midpoint(min: number, max: number, t: number): number {
  return Math.round(min + (max - min) * t);
}

export function suggestDuration(
  transitionKind: string,
  elementSize?: number,
  platform?: 'mobile' | 'desktop',
): TimingSuggestion {
  const range = TRANSITION_RANGES[transitionKind] ?? defaultRange(transitionKind);

  if (range.min === 0 && range.max === 0) {
    return { duration: 0, reason: range.reason };
  }

  const sizeFactor = elementSize != null ? Math.min(elementSize / 1000, 1) : 0.5;
  let duration = midpoint(range.min, range.max, sizeFactor);

  if (platform === 'mobile') {
    duration = Math.max(200, Math.min(300, duration));
  } else if (platform === 'desktop') {
    duration = Math.max(150, Math.min(250, duration));
  }

  return { duration, reason: range.reason };
}
