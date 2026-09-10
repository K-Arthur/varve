/**
 * IR structural parity — TS stub output vs shared fixture expectations.
 * Rust parity verified in apps/desktop/src-tauri round_trip_build_render_ir tests.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createEngine } from '../engine';
import type { SceneNode } from '../types';
import { estimateIrBytes } from './benchUtils';

const __dir = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dir, 'fixtures', 'basic-scene.json');

describe('IR parity fixtures', () => {
  it('stub engine builds IR matching fixture node count', async () => {
    const raw = readFileSync(fixturePath, 'utf-8');
    const nodes = JSON.parse(raw) as SceneNode[];
    const eng = await createEngine('stub');
    const ir = await eng.buildIr({ nodes });
    expect(ir).toHaveLength(nodes.length);
  });

  it('rect item carries cornerRadius in primitive', async () => {
    const raw = readFileSync(fixturePath, 'utf-8');
    const nodes = JSON.parse(raw) as SceneNode[];
    const eng = await createEngine('stub');
    const ir = await eng.buildIr({ nodes });
    const rect = ir[0];
    expect(rect?.primitive.kind).toBe('rect');
    if (rect?.primitive.kind === 'rect') {
      expect(rect.primitive.cornerRadius).toBe(4);
    }
  });

  it('IR byte estimate is under 10KB for basic fixture', async () => {
    const raw = readFileSync(fixturePath, 'utf-8');
    const nodes = JSON.parse(raw) as SceneNode[];
    const eng = await createEngine('stub');
    const ir = await eng.buildIr({ nodes });
    expect(estimateIrBytes(ir)).toBeLessThan(10_000);
  });

  it('fills stack passes through to render item when present', async () => {
    const nodes: SceneNode[] = [
      {
        id: 'g1',
        name: 'Gradient',
        transform: [1, 0, 0, 1, 0, 0],
        shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
        fills: [
          {
            type: 'gradient',
            gradient: {
              type: 'linear',
              stops: [
                { position: 0, color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } },
                { position: 1, color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } },
              ],
            },
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        ],
      },
    ];
    const eng = await createEngine('stub');
    const ir = await eng.buildIr({ nodes });
    expect(ir[0]?.fills).toBeDefined();
    expect(ir[0]?.fills?.[0]?.type).toBe('gradient');
  });
});
