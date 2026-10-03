/**
 * nameLabelPolicy — Figma-style when-to-show policy.
 */
import { describe, expect, it } from 'vitest';
import {
  NAME_LABEL_MAX,
  NAME_LABEL_ZOOM_THRESHOLD,
  type NameLabelCandidate,
  oneLineLabelName,
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

  it('keeps nested frame names transient unless they are active', () => {
    expect(
      shouldShowNameLabel({
        kind: 'frame',
        zoom: 1,
        screenW: 400,
        screenH: 300,
        name: 'Nested',
        insideContainer: true,
      }),
    ).toBe(false);
    expect(
      shouldShowNameLabel({
        kind: 'frame',
        zoom: 1,
        screenW: 400,
        screenH: 300,
        name: 'Nested',
        insideContainer: true,
        forceShow: true,
      }),
    ).toBe(true);
  });

  it('normalizes unsafe names without changing Unicode content', () => {
    expect(oneLineLabelName('  שלום\n世界\t\u2728\u0000  ')).toBe('שלום 世界 \u2728');
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

  const project = (c: NameLabelCandidate) => ({
    screenX: c.x,
    screenY: c.y,
    screenW: c.w,
    screenH: c.h,
  });

  it('keeps every overlapping selected name separate and outside selected artwork', () => {
    const selected = [
      { id: 'photo', name: 'photo.png', x: 370, y: 260, w: 1, h: 1 },
      { id: 'rect', name: 'Rectangle', x: 360, y: 270, w: 100, h: 60 },
      { id: 'circle', name: 'Circle', x: 386, y: 276, w: 48, h: 48 },
    ].map((node) => ({ ...node, kind: 'shape', depth: 0, parentId: null, selected: true }));
    const picked = pickNameLabelCandidates(selected, {
      zoom: 1,
      viewportW: 740,
      viewportH: 521,
      project,
    });
    expect(picked.map((label) => label.fullName)).toEqual(['photo.png', 'Rectangle', 'Circle']);
    // Vertical gap readouts between tiny targets can extend 22px above the
    // selection; keeping names outside bodies alone is insufficient.
    expect(picked.every((label) => label.labelY + 18 < 260 - 22)).toBe(true);
    expect(new Set(picked.map((label) => label.labelY)).size).toBe(3);
    // Collision relief must not change the bounds used to identify the node.
    expect(picked.find((label) => label.id === 'circle')?.screenY).toBe(276);
  });

  it('places selected names below artwork when no readable row fits above', () => {
    const selected = ['One', 'Two'].map((name, index) => ({
      id: `${index}`,
      name,
      x: 70,
      y: 2,
      w: 40,
      h: 30,
      kind: 'shape',
      depth: 0,
      parentId: null,
      selected: true,
    }));
    const picked = pickNameLabelCandidates(selected, {
      zoom: 1,
      viewportW: 160,
      viewportH: 120,
      project,
    });
    expect(picked).toHaveLength(2);
    expect(picked[0]?.labelY).toBe(34);
    expect(picked[1]?.labelY).toBe(54);
  });

  it('bounds the crowded no-free-space fallback without dropping selected identities', () => {
    const selected = Array.from({ length: 1000 }, (_, index) => ({
      id: `selected-${index}`,
      name: `Layer ${index}`,
      x: 20,
      y: 0,
      w: 100,
      h: 40,
      kind: 'shape',
      depth: 0,
      parentId: null,
      selected: true,
      paintOrder: index,
    }));
    const picked = pickNameLabelCandidates(selected, {
      zoom: 1,
      viewportW: 160,
      viewportH: 40,
      project,
    });
    expect(picked).toHaveLength(NAME_LABEL_MAX);
    expect(picked.map((label) => label.fullName)).toEqual(
      selected.slice(0, NAME_LABEL_MAX).map((node) => node.name),
    );
    expect(picked.every((label) => Number.isFinite(label.labelY) && label.labelY >= 4)).toBe(true);
  });
});
