export interface EasingSuggestion {
  easing: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

const EASE_SUGGESTIONS: Record<
  string,
  {
    base: { easing: string; reason: string; confidence: 'high' | 'medium' | 'low' };
    long?: { easing: string; reason: string; confidence?: 'high' | 'medium' | 'low' };
  }
> = {
  opacity: {
    base: {
      easing: 'ease',
      reason: 'Opacity fades are best with a standard ease curve',
      confidence: 'high',
    },
  },
  transform: {
    base: {
      easing: 'easeOut',
      reason: 'Position changes under 50px benefit from easeOut for a natural deceleration',
      confidence: 'high',
    },
    long: {
      easing: 'spring',
      reason: 'Position changes over 50px benefit from spring physics for natural overshoot',
      confidence: 'medium',
    },
  },
  position: {
    base: {
      easing: 'easeOut',
      reason: 'Position changes under 50px benefit from easeOut for a natural deceleration',
      confidence: 'high',
    },
    long: {
      easing: 'spring',
      reason: 'Position changes over 50px benefit from spring physics for natural overshoot',
      confidence: 'medium',
    },
  },
  scale: {
    base: {
      easing: 'easeOut',
      reason: 'Scale changes feel natural with easeOut — objects appear to settle',
      confidence: 'high',
    },
  },
  rotation: {
    base: {
      easing: 'easeInOut',
      reason: 'Rotations look polished with easeInOut — smooth start and finish',
      confidence: 'medium',
    },
  },
};

export function suggestEasing(property: string, distance?: number): EasingSuggestion {
  const entry = EASE_SUGGESTIONS[property];
  if (!entry) {
    return {
      easing: 'ease',
      reason: 'Default easing for unsupported properties',
      confidence: 'low',
    };
  }

  if (entry.long && distance != null && distance >= 50) {
    return {
      easing: entry.long.easing,
      reason: entry.long.reason,
      confidence: 'medium',
    };
  }

  return { ...entry.base };
}
