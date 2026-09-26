import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Solid-paint GPU reachability: a real document's items must reach the
 * compositor's WebGPU runs.
 *
 * isGpuBatchSupported originally required an empty fills stack, while every
 * real filled node carries one — so the GPU pipelines only ever saw synthetic
 * legacy-fill fixtures and every real item fell back as unsupported-paint.
 * This spec closes the seam end to end in a real browser: scene nodes with
 * paint stacks (the shape every created shape carries) go through the real
 * engine's buildIr, then through buildStructuralRenderPlan, and the plan must
 * route solid rect/circle items to WebGPU runs while gradient, stacked, and
 * stroked items keep their Canvas2D islands. No GPU is required: the plan is
 * pure, and the SwiftShader decline policy is covered by webgpu-smoke.
 */

test.use({
  launchOptions: {
    args: [
      '--enable-unsafe-webgpu',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
    ],
  },
});

test('solid paints from scene fills stacks reach WebGPU runs in the structural plan', async ({
  page,
}) => {
  // Origin bootstrap only (same pattern as circle-transform-parity): the app
  // at `/` boots the editor and fires its own navigation mid-boot, which
  // destroys an evaluation context set up too early. Let boot settle (the
  // editor shell appearing means the module graph and boot navigation are
  // done), then replace the document with a stable one on the same origin.
  await page.goto('/');
  await page
    .locator('.editor-shell')
    .waitFor({ state: 'visible', timeout: 45000 })
    .catch(() => {
      // A hung boot fires no further navigation, which is equally safe.
    });
  await page.setContent('<html><body><div id="compositor-parity-host"></div></body></html>');

  const engineModuleUrl = `/@fs${path.resolve(process.cwd(), 'packages/engine/src/index.ts')}`;
  const compositorModuleUrl = `/@fs${path.resolve(process.cwd(), 'packages/compositor/src/index.ts')}`;

  const result = await page.evaluate(
    async ({ engineModuleUrl, compositorModuleUrl }) => {
      try {
        const engineMod = (await import(
          /* @vite-ignore */ engineModuleUrl
        )) as typeof import('@varve/engine');
        const compositorMod = (await import(
          /* @vite-ignore */ compositorModuleUrl
        )) as typeof import('@varve/compositor');

        const solid = {
          type: 'solid' as const,
          color: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 },
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
        };
        const nodes: Array<Record<string, unknown>> = [
          // Six plain solid shapes — the content class that must reach GPU.
          ...Array.from({ length: 6 }, (_, index) => ({
            id: `rect-${index}`,
            fills: [{ ...solid }],
            opacity: 1,
            blendMode: 'normal',
            strokes: [],
            effects: [],
            transform: [1, 0, 0, 1, index * 40, 10],
            shape: { kind: 'rect', x: 0, y: 0, w: 30, h: 30 },
          })),
          {
            id: 'ellipse-0',
            fills: [{ ...solid, color: { space: 'rgb', r: 200, g: 50, b: 50, a: 255 } }],
            opacity: 1,
            blendMode: 'normal',
            strokes: [],
            effects: [],
            transform: [1, 0, 0, 1, 10, 100],
            shape: { kind: 'ellipse', cx: 0, cy: 0, rx: 20, ry: 12 },
          },
          {
            id: 'circle-0',
            fills: [{ ...solid, color: { space: 'rgb', r: 30, g: 30, b: 200, a: 255 } }],
            opacity: 1,
            blendMode: 'normal',
            strokes: [],
            effects: [],
            transform: [1, 0, 0, 1, 60, 100],
            shape: { kind: 'circle', cx: 0, cy: 0, r: 15 },
          },
          // Gradient paint must stay on the Canvas2D island. Scene fills nest
          // the gradient payload under `gradient` (the engine's FillIR mapper
          // reads f.gradient.type/stops/rotation).
          {
            id: 'gradient-0',
            fills: [
              {
                type: 'gradient',
                gradient: {
                  type: 'linear',
                  stops: [
                    { position: 0, color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 } },
                    { position: 1, color: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 } },
                  ],
                  rotation: 0,
                },
                opacity: 1,
                blendMode: 'normal',
                visible: true,
              },
            ],
            opacity: 1,
            blendMode: 'normal',
            strokes: [],
            effects: [],
            transform: [1, 0, 0, 1, 100, 100],
            shape: { kind: 'rect', x: 0, y: 0, w: 30, h: 30 },
          },
          // A stroke must stay on the Canvas2D island.
          {
            id: 'stroked-0',
            fills: [{ ...solid }],
            opacity: 1,
            blendMode: 'normal',
            strokes: [
              {
                color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
                weight: 2,
                align: 'center',
                dashPattern: [],
                dashOffset: 0,
                cap: 'round',
                join: 'round',
                miterLimit: 4,
                visible: true,
              },
            ],
            effects: [],
            transform: [1, 0, 0, 1, 200, 100],
            shape: { kind: 'rect', x: 0, y: 0, w: 30, h: 30 },
          },
        ];

        const engine = await engineMod.createEngine('stub');
        const ir = await engine.buildIr({ nodes: nodes as never });

        const plan = compositorMod.buildStructuralRenderPlan(ir);
        const segments = plan.segments.map((segment) => ({
          kind: segment.kind,
          count: segment.items.length,
        }));
        return {
          ok: true,
          error: null,
          itemCount: ir.length,
          nativeWebGpuItems: plan.nativeWebGpuItems,
          fallbackNodeCount: plan.fallbackNodeCount,
          segments,
          reasons: { ...plan.fallbackReasons } as Record<string, number>,
        };
      } catch (error) {
        return {
          ok: false,
          error: String(error),
          itemCount: 0,
          nativeWebGpuItems: 0,
          fallbackNodeCount: 0,
          segments: [],
          reasons: {} as Record<string, number>,
        };
      }
    },
    { engineModuleUrl, compositorModuleUrl },
  );

  expect(result.ok, result.error ?? 'in-page evaluation failed').toBe(true);
  expect(result.itemCount).toBe(10);
  // 6 solid rects + 1 solid ellipse + 1 solid circle reach GPU runs.
  expect(result.nativeWebGpuItems).toBe(8);
  // Gradient + stroked items stay on the accurate Canvas2D path.
  expect(result.fallbackNodeCount).toBe(2);
  expect(result.reasons['unsupported-paint']).toBe(1);
  expect(result.reasons['stroke']).toBe(1);
});
