import type { Timeline } from '@strata/scene';
import type { EasingDefinition } from '@strata/shared';

function easingToCSS(easing: EasingDefinition): string {
  switch (easing.kind) {
    case 'linear':
      return 'linear';
    case 'ease':
      return 'ease';
    case 'easeIn':
      return 'ease-in';
    case 'easeOut':
      return 'ease-out';
    case 'easeInOut':
      return 'ease-in-out';
    case 'cubicBezier':
      return `cubic-bezier(${easing.x1}, ${easing.y1}, ${easing.x2}, ${easing.y2})`;
    case 'steps':
      return `steps(${easing.count}${easing.position ? `, ${easing.position}` : ''})`;
    case 'spring':
      return 'cubic-bezier(0.34, 1.56, 0.64, 1)';
    default:
      return 'linear';
  }
}

function cssPropertyName(property: string): string {
  if (property === 'opacity') return 'opacity';
  if (property === 'rotation') return 'transform';
  if (property.startsWith('fills[')) {
    if (property.endsWith('.opacity')) return 'opacity';
    return '--fill-color';
  }
  return property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function cssPropertyValue(property: string, value: unknown): string {
  if (typeof value === 'number') {
    if (property === 'opacity' || property.endsWith('.opacity')) return String(value);
    if (property === 'rotation') return `rotate(${value}deg)`;
    if (['fontSize', 'letterSpacing', 'cornerRadius', 'w', 'h', 'x', 'y'].includes(property)) {
      return `${value}px`;
    }
    if (property.startsWith('transform[')) return `${value}px`;
    return String(value);
  }
  if (typeof value === 'string') {
    if (value.startsWith('#')) return value;
    return `"${value}"`;
  }
  return String(value);
}

export function timelineToCSSKeyframes(
  timeline: Timeline,
  nodeNames: Record<string, string>,
): string {
  const rules: string[] = [];

  for (const track of timeline.tracks) {
    const kfs = track.keyframes;
    if (!kfs || kfs.length < 2) continue;
    if (track.enabled === false) continue;

    const nodeName = nodeNames[track.nodeId] ?? `node-${track.nodeId}`;
    const prop = track.property;
    const name = `${nodeName}-${prop}`;
    const cssProp = cssPropertyName(prop);

    const parts: string[] = [`@keyframes ${name} {`];
    for (let i = 0; i < kfs.length; i++) {
      const kf = kfs[i];
      if (!kf) continue;
      const pct = `${(kf.progress * 100).toFixed(2)}%`.replace(/\.?0+%$/, '%');
      const val = cssPropertyValue(prop, kf.value);
      const indent = '  ';
      parts.push(`${indent}${pct} {`);
      parts.push(`${indent}  ${cssProp}: ${val};`);
      if (i > 0 && kf.easing) {
        parts.push(`${indent}  animation-timing-function: ${easingToCSS(kf.easing)};`);
      }
      parts.push(`${indent}}`);
    }
    parts.push('}');
    rules.push(parts.join('\n'));
  }

  return rules.join('\n\n');
}
