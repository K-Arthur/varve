/**
 * nameLabelPolicy — Figma-style when-to-show policy.
 */
import { describe, expect, it } from 'vitest';
import {
  NAME_LABEL_ZOOM_THRESHOLD,
  type NameLabelCandidate,
  pickNameLabelCandidates,
  shouldShowNameLabel,
} from './nameLabelPolicy';

describe('shouldShowNameLabel', () => {
  it('always shows frame names when non-empty', () => {
    expect(
      shouldShowNameLabel({
        kind: 'frame',
        zoom: 2,
        screenW: 400,
        screenH: 800,
        name: 'MOJO - 8',
      }),
    ).toBe(true);
  });

  it('hides blank names', () => {
    expect(
      shouldShowNameLabel({
        kind: 'frame',
        zoom: 0.1,
        screenW: 10,
        screenH: 10,
        name: '   ',
      }),
    ).toBe(false);
  });

  it('shows non-frames when zoom is at or below threshold', () => {
    expect(
      shouldShowNameLabel({
        kind: 'shape',
        zoom: NAME_LABEL_ZOOM_THRESHOLD,
        screenW: 200,
        screenH: 200,
        name: 'Rect 1',
      }),
    ).toBe(true);
  });

  it('hides large non-frames when zoomed in', () => {
    expect(
      shouldShowNameLabel({
        kind: 'shape',
        zoom: 1,
        screenW: 200,
        screenH: 200,
        name: 'Rect 1',
      }),
    ).toBe(false);
  });

  it('shows tiny non-frames even when zoomed in', () => {
    expect(
      shouldShowNameLabel({
        kind: 'shape',
        zoom: 1,
        screenW: 16,
        screenH: 16,
        name: 'Icon',
      }),
    ).toBe(true);
  });
});

describe('pickNameLabelCandidates', () => {
  const base: NameLabelCandidate[] = [
    {
      id: 'f1',
      name: 'Frame A',
      kind: 'frame',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      depth: 0,
      parentId: null,
    },
    {
      id: 's1',
      name: 'Rect',
      kind: 'shape',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      depth: 1,
      parentId: 'f1',
    },
    {
      id: 'off',
      name: 'Offscreen',
      kind: 'frame',
      x: 10000,
      y: 10000,
      w: 50,
      h: 50,
      depth: 0,
      parentId: null,
    },
  ];

  it('prioritizes frames and culls off-screen', () => {
    const picked = pickNameLabelCandidates(base, {
      zoom: 1,
      viewportW: 800,
      viewportH: 600,
      project: (c) => ({
        screenX: c.x,
        screenY: c.y,
        screenW: c.w,
        screenH: c.h,
      }),
    });
    expect(picked.map((p) => p.id)).toEqual(['f1']);
  });

  it('keeps nested shapes hidden when zoomed out', () => {
    const picked = pickNameLabelCandidates(base, {
      zoom: 0.2,
      viewportW: 800,
      viewportH: 600,
      project: (c) => ({
        screenX: c.x * 0.2,
        screenY: c.y * 0.2,
        screenW: c.w * 0.2,
        screenH: c.h * 0.2,
      }),
    });
    expect(picked.map((p) => p.id)).toContain('f1');
    expect(picked.map((p) => p.id)).not.toContain('s1');
    expect(picked.map((p) => p.id)).not.toContain('off');
  });
});
