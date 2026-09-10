/**
 * Guide overlay performance — 1K guides screen projection budget.
 */
import { addGuide, createDocument, type Guide } from '@varve/scene';
import { describe, expect, test } from 'vitest';
import { guideLineScreenEndpoints } from '../../../canvas/guideGeometry';

function build1kGuides(): Guide[] {
  let doc = createDocument('guides-bench');
  const pageId = doc.activePageId ?? doc.pages?.[0]?.id;
  for (let i = 0; i < 500; i++) {
    doc = addGuide(doc, 'vertical', i * 4, { pageId });
    doc = addGuide(doc, 'horizontal', i * 3, { pageId });
  }
  return doc.guides ?? [];
}

describe('guides1k bench', () => {
  test('projects 1000 guides under 100ms', () => {
    const guides = build1kGuides();
    expect(guides.length).toBe(1000);
    const cam = { zoom: 1, pan: { x: 0, y: 0 }, cameraRotation: 0 };
    const viewport = { width: 1280, height: 720 };
    const project = (): number => {
      const start = performance.now();
      for (const guide of guides) {
        guideLineScreenEndpoints({ axis: guide.axis, position: guide.position }, cam, viewport);
      }
      return performance.now() - start;
    };

    // Discard cold JIT/module work, then use a median so unrelated parallel
    // Vitest workers cannot turn one scheduler preemption into a regression.
    project();
    const samples = Array.from({ length: 5 }, project).sort((left, right) => left - right);
    expect(samples[2]).toBeLessThan(100);
  });
});
