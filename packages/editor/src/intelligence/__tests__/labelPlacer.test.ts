import { describe, expect, it } from 'vitest';
import { placeLabels, type LabelTarget } from '../labelPlacer';

function makeTarget(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
): LabelTarget {
  return {
    nodeId: id,
    targetX: x,
    targetY: y,
    targetW: w,
    targetH: h,
    labelText: text,
    labelW: text.length * 8,
    labelH: 20,
  };
}

describe('placeLabels', () => {
  it('returns empty array for no targets', () => {
    const result = placeLabels([]);
    expect(result).toEqual([]);
  });

  it('places a single label next to a target', () => {
    const targets = [makeTarget('n1', 100, 100, 50, 50, 'Hello')];
    const result = placeLabels(targets);

    expect(result).toHaveLength(1);
    expect(result[0]!.nodeId).toBe('n1');
    expect(result[0]!.labelText).toBe('Hello');
    expect(result[0]!.overlaps).toBe(false);
  });

  it('places labels without overlap for well-spaced targets', () => {
    const targets = [
      makeTarget('n1', 100, 100, 50, 50, 'Label A'),
      makeTarget('n2', 300, 100, 50, 50, 'Label B'),
    ];
    const result = placeLabels(targets);

    expect(result).toHaveLength(2);
    expect(result[0]!.overlaps).toBe(false);
    expect(result[1]!.overlaps).toBe(false);
  });

  it('handles many targets without error', () => {
    const targets: LabelTarget[] = [];
    for (let i = 0; i < 20; i++) {
      targets.push(makeTarget(`n${i}`, (i % 5) * 150, Math.floor(i / 5) * 150, 50, 50, `Node ${i}`));
    }
    const result = placeLabels(targets);
    expect(result).toHaveLength(20);
    for (const label of result) {
      expect(label.x).toBeGreaterThanOrEqual(0);
      expect(label.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('places labels in viewport bounds', () => {
    const targets = [makeTarget('n1', 0, 0, 10, 10, 'A long label that needs space')];
    const result = placeLabels(targets, 500, 500);
    expect(result).toHaveLength(1);
    expect(result[0]!.x).toBeGreaterThanOrEqual(0);
    expect(result[0]!.y).toBeGreaterThanOrEqual(0);
  });

  it('provides a direction for each placed label', () => {
    const targets = [makeTarget('n1', 200, 200, 100, 100, 'Center')];
    const result = placeLabels(targets);
    expect(result[0]!.direction).toBeTruthy();
    expect(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']).toContain(result[0]!.direction);
  });
});
