/**
 * SVG export must bake live warp modifiers into vector path data.
 *
 * SVG has no editable envelope-distort primitive, so the canonical evaluator
 * (@varve/engine warp) resolves the deformed geometry at export quality and
 * the result is emitted as ordinary path data (ADR-0166). Emitting the
 * unwarped source — or an affine `transform` standing in for a nonlinear
 * map — would silently misrepresent the document.
 */

import type { WarpModifier } from '@varve/engine';
import { resolveWarpTolerance, WARP_QUALITY_TOLERANCE, warpShapeToPath } from '@varve/engine';
import { createDocument, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { analyzeNodeFlattening } from '../flattening';
import { exportNodeToSvg, svgTargetGaps } from '../svg';
import { bakeWarpedShape, EXPORT_WARP_QUALITY } from '../warpBake';

const BLACK = { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } as const;

function docWith(node: ReturnType<typeof makeShapeNode>) {
  return {
    ...createDocument('Warp export', true),
    rootChildren: [node.id],
    nodes: { [node.id]: node },
  };
}

/** A 100×100 square at the origin — trivial to reason about under warp. */
function square(id: string) {
  return makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }, { fill: BLACK });
}

/** Pull every numeric coordinate out of a `d="..."` attribute. */
function pathCoords(svg: string): number[] {
  const match = /d="([^"]+)"/.exec(svg);
  if (!match) return [];
  // Must accept exponent notation, or `4e-15` would parse as two numbers.
  return (match[1]?.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number);
}

describe('SVG export: warp baking', () => {
  it('bakes a perspective warp into path data instead of emitting the source rect', () => {
    const warp: WarpModifier = {
      id: 'w1',
      kind: 'perspective',
      enabled: true,
      coordinateSpace: 'normalized-source',
      // Top edge inset by 25% on both sides — a trapezoid, not representable
      // by any affine transform.
      corners: {
        tl: { x: 0.25, y: 0 },
        tr: { x: 0.75, y: 0 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 1 },
      },
    };
    const node = { ...square('s1'), warps: [warp] };

    const svg = exportNodeToSvg(node, docWith(node));

    // The source rect must not survive as a <rect>.
    expect(svg).not.toContain('<rect x="0" y="0" width="100" height="100"');
    expect(svg).toContain('<path');

    const coords = pathCoords(svg);
    expect(coords.length).toBeGreaterThan(0);
    // The trapezoid's top edge starts at x=25 (25% of 100), not x=0.
    expect(coords[0]).toBeCloseTo(25, 1);
    expect(coords[1]).toBeCloseTo(0, 1);
  });

  it('bakes a bend warp, producing curvature the source rect does not have', () => {
    const warp: WarpModifier = {
      id: 'w2',
      kind: 'bend',
      enabled: true,
      coordinateSpace: 'normalized-source',
      mode: 'arc',
      amount: 0.6,
      axis: 'horizontal',
      origin: 0.5,
    };
    const node = { ...square('s2'), warps: [warp] };

    const svg = exportNodeToSvg(node, docWith(node));

    expect(svg).toContain('<path');
    // A bend subdivides the straight edges, so the baked ring carries far
    // more than the rect's four corners (which alone would be 5 emitted
    // points once the ring closes).
    const coords = pathCoords(svg);
    expect(coords.length / 2).toBeGreaterThan(20);
  });

  it('curves a straight edge that a nonlinear warp bends', () => {
    // Regression: straight segments used to be mapped endpoint-only, so a
    // rectangle kept perfectly straight sides under an envelope and the
    // deformation along each edge was silently dropped.
    const warp: WarpModifier = {
      id: 'w9',
      kind: 'envelope',
      enabled: true,
      coordinateSpace: 'normalized-source',
      interpolation: 'coons',
      corners: {
        tl: { x: 0, y: 0 },
        tr: { x: 1, y: 0 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 1 },
      },
      edges: {
        // Top edge pulled well above the box; bottom/left/right identity.
        top: [
          { x: 1 / 3, y: -0.5 },
          { x: 2 / 3, y: -0.5 },
        ],
        right: [
          { x: 1, y: 1 / 3 },
          { x: 1, y: 2 / 3 },
        ],
        bottom: [
          { x: 1 / 3, y: 1 },
          { x: 2 / 3, y: 1 },
        ],
        left: [
          { x: 0, y: 1 / 3 },
          { x: 0, y: 2 / 3 },
        ],
      },
    };
    const node = { ...square('s9'), warps: [warp] };

    const svg = exportNodeToSvg(node, docWith(node));
    const coords = pathCoords(svg);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < coords.length; i += 2) pts.push([coords[i]!, coords[i + 1]!]);

    // The corners are unmoved (identity corners), so any point rising well
    // above y=0 can only come from subdividing the top edge.
    const minY = Math.min(...pts.map(([, y]) => y));
    expect(minY).toBeLessThan(-20);
    // ...and it must be an interior point of the top edge, not a corner.
    const lifted = pts.filter(([x, y]) => y < -20 && x > 1 && x < 99);
    expect(lifted.length).toBeGreaterThan(0);
  });

  it('leaves geometry untouched when the only warp is disabled', () => {
    const warp: WarpModifier = {
      id: 'w3',
      kind: 'skew',
      enabled: false,
      coordinateSpace: 'normalized-source',
      skewX: 30,
      skewY: 0,
      origin: { x: 0.5, y: 0.5 },
    };
    const node = { ...square('s3'), warps: [warp] };

    const svg = exportNodeToSvg(node, docWith(node));

    // Disabled modifiers must restore the exact source representation.
    expect(svg).toContain('<rect x="0" y="0" width="100" height="100"');
  });

  it('preserves compound-path holes and fill-rule through the bake', () => {
    const warp: WarpModifier = {
      id: 'w4',
      kind: 'skew',
      enabled: true,
      coordinateSpace: 'normalized-source',
      skewX: 20,
      skewY: 0,
      origin: { x: 0.5, y: 0.5 },
    };
    const node = {
      ...makeShapeNode(
        's4',
        {
          kind: 'path',
          closed: true,
          tolerance: 1,
          fillRule: 'evenodd',
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: null },
            { x: 20, y: 0, handleIn: null, handleOut: null },
            { x: 20, y: 20, handleIn: null, handleOut: null },
            { x: 0, y: 20, handleIn: null, handleOut: null },
          ],
          holes: [
            [
              { x: 5, y: 5, handleIn: null, handleOut: null },
              { x: 15, y: 5, handleIn: null, handleOut: null },
              { x: 15, y: 15, handleIn: null, handleOut: null },
              { x: 5, y: 15, handleIn: null, handleOut: null },
            ],
          ],
        },
        { fill: BLACK },
      ),
      warps: [warp],
    };

    const svg = exportNodeToSvg(node, docWith(node));

    expect(svg).toContain('fill-rule="evenodd"');
    // Outer ring + one hole ring → two subpaths.
    const d = /d="([^"]+)"/.exec(svg)?.[1] ?? '';
    expect(d.match(/M /g)?.length).toBe(2);
  });

  it('grows the viewBox to contain geometry pushed outside the source bounds', () => {
    const warp: WarpModifier = {
      id: 'w5',
      kind: 'skew',
      enabled: true,
      coordinateSpace: 'normalized-source',
      skewX: 45,
      skewY: 0,
      origin: { x: 0, y: 0 },
    };
    const node = { ...square('s5'), warps: [warp] };

    const svg = exportNodeToSvg(node, docWith(node));

    const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '';
    const [, , w] = viewBox.split(' ').map(Number);
    // A 45° shear over 100px of height displaces the bottom edge by ~100px,
    // so the source's 100px width can no longer contain the result.
    expect(w).toBeGreaterThan(150);
  });

  it('emits no float noise for coordinates that are exactly zero', () => {
    const warp: WarpModifier = {
      id: 'w6',
      kind: 'perspective',
      enabled: true,
      coordinateSpace: 'normalized-source',
      corners: {
        tl: { x: 0.25, y: 0 },
        tr: { x: 0.75, y: 0 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 1 },
      },
    };
    const node = { ...square('s6'), warps: [warp] };

    const svg = exportNodeToSvg(node, docWith(node));

    // Homography arithmetic lands on 4.6e-15 rather than 0; exporting that
    // verbatim bloats the file and reads as a real offset.
    expect(svg).not.toMatch(/e-\d+/);
  });
});

describe('export bake fidelity', () => {
  it('resolves the same tolerance Expand Appearance uses', () => {
    // Both destructive-bake paths must agree, or "expand" and "export" would
    // produce different geometry for the same document (task §26).
    expect(resolveWarpTolerance(EXPORT_WARP_QUALITY)).toBe(
      resolveWarpTolerance({ profile: 'export' }),
    );
    expect(resolveWarpTolerance(EXPORT_WARP_QUALITY)).toBe(WARP_QUALITY_TOLERANCE.export);
  });

  it('bakes at export tolerance, not the interactive default', () => {
    const warp: WarpModifier = {
      id: 'w10',
      kind: 'bend',
      enabled: true,
      coordinateSpace: 'normalized-source',
      mode: 'arc',
      amount: 0.6,
      axis: 'horizontal',
      origin: 0.5,
    };
    const node = { ...square('s10'), warps: [warp] };
    const exported = bakeWarpedShape(node)?.shape;
    const interactive = warpShapeToPath(
      node.shape,
      [warp],
      { x: 0, y: 0, w: 100, h: 100 },
      {
        quality: { profile: 'interactive' },
      },
    ).shape;

    const count = (s: typeof exported) => (s && s.kind === 'path' ? s.points.length : 0);
    expect(count(exported)).toBeGreaterThan(count(interactive));
  });
});

describe('warps this exporter cannot bake', () => {
  const bend: WarpModifier = {
    id: 'wt',
    kind: 'bend',
    enabled: true,
    coordinateSpace: 'normalized-source',
    mode: 'arc',
    amount: 0.5,
    axis: 'horizontal',
    origin: 0.5,
  };

  it('flags warped text instead of exporting it as clean', () => {
    const text = {
      id: 't1',
      name: 'Headline',
      kind: 'text' as const,
      text: 'Hello',
      fontSize: 24,
      fill: BLACK,
      transform: [1, 0, 0, 1, 0, 0] as const,
      visible: true,
      warps: [bend],
    } as unknown as Parameters<typeof exportNodeToSvg>[0];
    const doc = { ...createDocument('Text warp', true), rootChildren: ['t1'], nodes: { t1: text } };

    const svg = exportNodeToSvg(text, doc as never);
    // Self-documenting output: the file states the warp was not applied.
    expect(svg).toContain('live warp not baked');

    const gaps = svgTargetGaps(text, doc as never);
    expect(gaps.some((g) => g.feature === 'warped text' && g.severity === 'warning')).toBe(true);
  });

  it('reports nothing for a warped shape, which does bake', () => {
    const node = { ...square('sok'), warps: [bend] };
    const gaps = svgTargetGaps(node, docWith(node) as never);
    expect(gaps.some((g) => String(g.feature).startsWith('warped'))).toBe(false);
    expect(exportNodeToSvg(node, docWith(node))).not.toContain('live warp not baked');
  });
});

describe('code-target flattening: warp', () => {
  it('flags a nonlinear warp so targets do not emit unwarped source geometry', () => {
    const doc = createDocument('Flatten', true);
    const warp: WarpModifier = {
      id: 'w7',
      kind: 'bend',
      enabled: true,
      coordinateSpace: 'normalized-source',
      mode: 'arc',
      amount: 0.5,
      axis: 'horizontal',
      origin: 0.5,
    };
    const node = { ...square('f1'), warps: [warp] };

    const spec = analyzeNodeFlattening(node, doc);

    expect(spec.mustFlatten).toBe(true);
    expect(spec.reasons).toContain('warp');
  });

  it('does not flag a node whose only warp is disabled', () => {
    const doc = createDocument('Flatten', true);
    const warp: WarpModifier = {
      id: 'w8',
      kind: 'bend',
      enabled: false,
      coordinateSpace: 'normalized-source',
      mode: 'arc',
      amount: 0.5,
      axis: 'horizontal',
      origin: 0.5,
    };
    const node = { ...square('f2'), warps: [warp] };

    expect(analyzeNodeFlattening(node, doc).reasons).not.toContain('warp');
  });
});
