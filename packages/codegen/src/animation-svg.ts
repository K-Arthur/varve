import type { Timeline } from '@varve/scene';

function formatValues(keyframes: { value: unknown }[]): string {
  return keyframes.map((k) => String(k.value)).join(';');
}

function formatKeyTimes(keyframes: { progress: number }[]): string {
  return keyframes.map((k) => k.progress.toFixed(4)).join(';');
}

function animateAttributes(property: string): {
  tag: 'animate' | 'animateTransform' | 'set';
  attributeName: string;
  type?: string;
} {
  if (property === 'rotation') {
    return { tag: 'animateTransform', attributeName: 'transform', type: 'rotate' };
  }
  return { tag: 'animate', attributeName: property };
}

export function timelineToSVGAnimations(
  timeline: Timeline,
  elementIds: Record<string, string>,
): string {
  const elements: string[] = [];

  for (const track of timeline.tracks) {
    const kfs = track.keyframes;
    if (!kfs || kfs.length === 0) continue;
    if (track.enabled === false) continue;

    const href = elementIds[track.nodeId]
      ? `#${elementIds[track.nodeId]}`
      : `#node-${track.nodeId}`;
    const { tag, attributeName, type } = animateAttributes(track.property);
    const dur = `${timeline.duration}ms`;

    if (track.interpolation === 'discrete' || kfs.length === 1) {
      const lastKf = kfs[kfs.length - 1];
      const value = String(lastKf ? lastKf.value : '');
      elements.push(
        `  <set href="${href}" attributeName="${attributeName}" to="${value}" dur="${dur}" />`,
      );
    } else {
      const values = formatValues(kfs);
      const keyTimes = formatKeyTimes(kfs);
      const typeAttr = type ? ` type="${type}"` : '';
      elements.push(
        `  <${tag} href="${href}" attributeName="${attributeName}"${typeAttr} values="${values}" keyTimes="${keyTimes}" dur="${dur}" fill="freeze" />`,
      );
    }
  }

  return elements.join('\n');
}
