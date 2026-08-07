/**
 * Not an assertion test — a generator for visual verification of the warp
 * export bake. Writes one SVG per modifier kind so the baked geometry can be
 * eyeballed (and rasterized into a contact sheet) rather than only trusted
 * through numeric assertions.
 *
 * Enabled by setting VARVE_WARP_VISUAL=1; skipped in normal runs.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WarpModifier } from '@varve/engine';
import { createDocument, makeShapeNode } from '@varve/scene';
import { describe, it } from 'vitest';
import { exportNodeToSvg } from '../svg';

const OUT = process.env.VARVE_WARP_VISUAL_DIR ?? '/tmp/varve-warp-visual';
const ENABLED = process.env.VARVE_WARP_VISUAL === '1';

const FILL = { space: 'rgb', r: 30, g: 90, b: 220, a: 255 } as const;

/** A grid of bars — deformation is obvious on a regular pattern. */
function striped(id: string, warps: WarpModifier[]) {
  const points: Array<{ x: number; y: number; handleIn: null; handleOut: null }> = [];
  const holes: Array<Array<{ x: number; y: number; handleIn: null; handleOut: null }>> = [];
  for (let i = 0; i < 4; i += 1) {
    const x = 10 + i * 45;
    holes.push([
      { x, y: 20, handleIn: null, handleOut: null },
      { x: x + 20, y: 20, handleIn: null, handleOut: null },
      { x: x + 20, y: 180, handleIn: null, handleOut: null },
      { x, y: 180, handleIn: null, handleOut: null },
    ]);
  }
  points.push(
    { x: 0, y: 0, handleIn: null, handleOut: null },
    { x: 200, y: 0, handleIn: null, handleOut: null },
    { x: 200, y: 200, handleIn: null, handleOut: null },
    { x: 0, y: 200, handleIn: null, handleOut: null },
  );
  return {
    ...makeShapeNode(
      id,
      { kind: 'path', closed: true, tolerance: 1, fillRule: 'evenodd', points, holes },
      { fill: FILL },
    ),
    warps,
  };
}

function meshPoints(rows: number, columns: number, bulge: number) {
  const pts: Array<{ x: number; y: number }> = [];
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= columns; c += 1) {
      const u = c / columns;
      const v = r / rows;
      // Radial bulge away from the centre.
      const dx = u - 0.5;
      const dy = v - 0.5;
      const d = Math.hypot(dx, dy);
      const k = 1 + bulge * Math.max(0, 1 - d * 2);
      pts.push({ x: 0.5 + dx * k, y: 0.5 + dy * k });
    }
  }
  return pts;
}

const CASES: Array<{ name: string; warps: WarpModifier[] }> = [
  { name: '00-source', warps: [] },
  {
    name: '01-skew',
    warps: [
      {
        id: 'm',
        kind: 'skew',
        enabled: true,
        coordinateSpace: 'normalized-source',
        skewX: 25,
        skewY: 0,
        origin: { x: 0.5, y: 0.5 },
      },
    ],
  },
  {
    name: '02-perspective',
    warps: [
      {
        id: 'm',
        kind: 'perspective',
        enabled: true,
        coordinateSpace: 'normalized-source',
        corners: {
          tl: { x: 0.22, y: 0.05 },
          tr: { x: 0.78, y: 0.05 },
          br: { x: 1.05, y: 1 },
          bl: { x: -0.05, y: 1 },
        },
      },
    ],
  },
  {
    name: '03-envelope',
    warps: [
      {
        id: 'm',
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
          top: [
            { x: 0.33, y: -0.35 },
            { x: 0.66, y: -0.35 },
          ],
          right: [
            { x: 1, y: 0.33 },
            { x: 1, y: 0.66 },
          ],
          // Canonical parameterization: bottom runs bl→br and left runs
          // tl→bl (same direction as the edge opposite it), per fit.ts.
          bottom: [
            { x: 0.33, y: 1.35 },
            { x: 0.66, y: 1.35 },
          ],
          left: [
            { x: 0, y: 0.33 },
            { x: 0, y: 0.66 },
          ],
        },
      },
    ],
  },
  {
    name: '04-mesh-bilinear',
    warps: [
      {
        id: 'm',
        kind: 'mesh-warp',
        enabled: true,
        coordinateSpace: 'normalized-source',
        rows: 4,
        columns: 4,
        interpolation: 'bilinear',
        points: meshPoints(4, 4, 0.45),
      },
    ],
  },
  {
    name: '05-mesh-bicubic',
    warps: [
      {
        id: 'm',
        kind: 'mesh-warp',
        enabled: true,
        coordinateSpace: 'normalized-source',
        rows: 4,
        columns: 4,
        interpolation: 'bicubic',
        points: meshPoints(4, 4, 0.45),
      },
    ],
  },
  {
    name: '06-bend-arc',
    warps: [
      {
        id: 'm',
        kind: 'bend',
        enabled: true,
        coordinateSpace: 'normalized-source',
        mode: 'arc',
        amount: 0.7,
        axis: 'horizontal',
        origin: 0.5,
      },
    ],
  },
  {
    name: '07-bend-wave',
    warps: [
      {
        id: 'm',
        kind: 'bend',
        enabled: true,
        coordinateSpace: 'normalized-source',
        mode: 'wave',
        amount: 0.6,
        axis: 'horizontal',
        origin: 0.5,
      },
    ],
  },
  {
    name: '08-bend-flag',
    warps: [
      {
        id: 'm',
        kind: 'bend',
        enabled: true,
        coordinateSpace: 'normalized-source',
        mode: 'flag',
        amount: 0.6,
        axis: 'horizontal',
        origin: 0.5,
      },
    ],
  },
  {
    name: '09-stacked-skew-then-bend',
    warps: [
      {
        id: 'm1',
        kind: 'skew',
        enabled: true,
        coordinateSpace: 'normalized-source',
        skewX: 18,
        skewY: 0,
        origin: { x: 0.5, y: 0.5 },
      },
      {
        id: 'm2',
        kind: 'bend',
        enabled: true,
        coordinateSpace: 'normalized-source',
        mode: 'arc',
        amount: 0.5,
        axis: 'horizontal',
        origin: 0.5,
      },
    ],
  },
];

describe.skipIf(!ENABLED)('warp visual generation', () => {
  it('writes one baked SVG per modifier kind', () => {
    mkdirSync(OUT, { recursive: true });
    for (const { name, warps } of CASES) {
      const node = striped(`n-${name}`, warps);
      const doc = {
        ...createDocument('Warp visual', true),
        rootChildren: [node.id],
        nodes: { [node.id]: node },
      };
      writeFileSync(join(OUT, `${name}.svg`), exportNodeToSvg(node, doc), 'utf8');
    }
    // eslint-disable-next-line no-console
    console.log(`wrote ${CASES.length} SVGs to ${OUT}`);
  });
});
