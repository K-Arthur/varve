export interface PresetRecommendation {
  presetId: string;
  matchScore: number;
  reason: string;
}

interface PresetDef {
  id: string;
  property: string;
  easing: string;
  minDuration: number;
  maxDuration: number;
  label: string;
}

const PRESETS: PresetDef[] = [
  {
    id: 'fade-in',
    property: 'opacity',
    easing: 'ease',
    minDuration: 200,
    maxDuration: 400,
    label: 'Fade In',
  },
  {
    id: 'slide-up',
    property: 'position',
    easing: 'easeOut',
    minDuration: 300,
    maxDuration: 500,
    label: 'Slide Up',
  },
  {
    id: 'slide-down',
    property: 'position',
    easing: 'easeOut',
    minDuration: 300,
    maxDuration: 500,
    label: 'Slide Down',
  },
  {
    id: 'slide-left',
    property: 'position',
    easing: 'easeOut',
    minDuration: 300,
    maxDuration: 500,
    label: 'Slide Left',
  },
  {
    id: 'slide-right',
    property: 'position',
    easing: 'easeOut',
    minDuration: 300,
    maxDuration: 500,
    label: 'Slide Right',
  },
  {
    id: 'scale-in',
    property: 'scale',
    easing: 'easeOut',
    minDuration: 200,
    maxDuration: 400,
    label: 'Scale In',
  },
  {
    id: 'rotate',
    property: 'rotation',
    easing: 'easeInOut',
    minDuration: 400,
    maxDuration: 600,
    label: 'Rotate',
  },
  {
    id: 'bounce-in',
    property: 'scale',
    easing: 'spring',
    minDuration: 300,
    maxDuration: 500,
    label: 'Bounce In',
  },
  {
    id: 'fade-slide-up',
    property: 'opacity',
    easing: 'easeOut',
    minDuration: 300,
    maxDuration: 500,
    label: 'Fade & Slide Up',
  },
];

function easingDistance(a: string, b: string): number {
  const groups: Record<string, string[]> = {
    ease: ['ease', 'easeInOut'],
    easeOut: ['easeOut', 'ease'],
    easeIn: ['easeIn', 'ease'],
    easeInOut: ['easeInOut', 'ease'],
    spring: ['spring'],
    linear: ['linear'],
  };

  if (a === b) return 0;
  if (groups[a]?.includes(b) || groups[b]?.includes(a)) return 0.25;
  return 1;
}

function durationDistance(duration: number, minDuration: number, maxDuration: number): number {
  if (duration >= minDuration && duration <= maxDuration) return 0;
  const center = (minDuration + maxDuration) / 2;
  return Math.abs(duration - center) / center;
}

export function recommendPresets(
  property: string,
  easing: string,
  duration: number,
): PresetRecommendation[] {
  const results: PresetRecommendation[] = [];

  for (const preset of PRESETS) {
    let score = 1;

    const propDist = preset.property === property ? 0 : 0.5;
    score -= propDist;

    const easeDist = easingDistance(preset.easing, easing);
    score -= easeDist * 0.3;

    const durDist = durationDistance(duration, preset.minDuration, preset.maxDuration);
    score -= durDist * 0.2;

    if (score > 0.5) {
      results.push({
        presetId: preset.id,
        matchScore: Math.round(score * 1000) / 1000,
        reason: `Matches "${preset.label}" pattern (${preset.property}, ${preset.easing})`,
      });
    }
  }

  results.sort((a, b) => b.matchScore - a.matchScore);
  return results;
}
