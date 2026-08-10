import type { SceneNode as EngineNode } from '@varve/engine';
import { getImageCache, type ImageErrorCode, resetImageCache } from '@varve/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectEngineImageResources,
  failureWarning,
  recoveryHintFor,
  settleEngineImageResources,
} from './resourceReadiness';

/** Minimal Image mock that dispatches onload/onerror when src is assigned. */
class MockImage {
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 1;
  naturalHeight = 1;
  width = 1;
  height = 1;
  private _src = '';
  get src(): string {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => MockImage.dispatch(this));
  }
  static dispatch(_img: MockImage): void {
    throw new Error('MockImage.dispatch must be set by the test');
  }
}

/** Build an engine node with scene-shaped fills (image nested under .image). */
function imageNode(
  id: string,
  fills: Array<{
    type: 'image' | 'pattern';
    src?: string;
    tileSrc?: string;
    alphaMask?: string;
    visible?: boolean;
  }>,
): EngineNode {
  return {
    id,
    name: id,
    transform: [1, 0, 0, 1, 0, 0],
    opacity: 1,
    blendMode: 'normal',
    fills: fills.map((f) => {
      if (f.type === 'pattern') {
        return {
          type: 'pattern',
          pattern: {
            tileSrc: f.tileSrc ?? '',
            spacing: 0,
            rotation: 0,
            imageWidth: 1,
            imageHeight: 1,
          },
          opacity: 1,
          blendMode: 'normal',
          visible: f.visible !== false,
        };
      }
      return {
        type: 'image',
        image: { src: f.src ?? '', fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: f.visible !== false,
        ...(f.alphaMask ? { alphaMask: f.alphaMask } : {}),
      };
    }),
  } as unknown as EngineNode;
}

function image(src: string): HTMLImageElement {
  return { src, naturalWidth: 1, naturalHeight: 1 } as unknown as HTMLImageElement;
}

let originalImage: typeof Image;

afterEach(() => {
  resetImageCache();
  globalThis.Image = originalImage;
  vi.restoreAllMocks();
});

beforeEach(() => {
  originalImage = globalThis.Image;
});

describe('collectEngineImageResources', () => {
  it('collects image fills, patterns and node masks exactly once', () => {
    const nodes = [
      imageNode('n1', [
        { type: 'image', src: 'asset-aaaaaaaaaaaaaaaa' },
        { type: 'pattern', tileSrc: 'data:image/png;base64,T' },
      ]),
      imageNode('n2', [{ type: 'image', src: 'asset-aaaaaaaaaaaaaaaa' }]),
    ];
    // Node-level alpha masks (background removal / native raster masks).
    (nodes[0] as unknown as { alphaMask: string }).alphaMask = 'data:image/png;base64,M1';
    (nodes[1] as unknown as { alphaMask: string }).alphaMask = 'data:image/png;base64,M2';

    const resources = collectEngineImageResources(nodes);
    expect(resources.map((r) => r.identity)).toEqual([
      'asset-aaaaaaaaaaaaaaaa',
      'data:image/png;base64,T',
      'data:image/png;base64,M1',
      'data:image/png;base64,M2',
    ]);
  });

  it('skips invisible fills', () => {
    const nodes = [
      imageNode('n1', [
        { type: 'image', src: 'data:image/png;base64,A', visible: false },
        { type: 'image', src: 'data:image/png;base64,B' },
      ]),
    ];
    expect(collectEngineImageResources(nodes).map((r) => r.identity)).toEqual([
      'data:image/png;base64,B',
    ]);
  });

  it('collects image fills compiled into table cell content', () => {
    const cellImage = imageNode('cell1', [{ type: 'image', src: 'asset-aaaaaaaaaaaaaaaa' }]);
    const maskedCell = imageNode('cell2', [{ type: 'image', src: 'data:image/png;base64,C' }]);
    const table = {
      id: 't1',
      name: 'table',
      transform: [1, 0, 0, 1, 0, 0],
      opacity: 1,
      blendMode: 'normal',
      shape: {
        kind: 'table',
        x: 0,
        y: 0,
        w: 100,
        h: 60,
        cornerRadius: 0,
        borderColor: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        borderWidth: 0,
        dividerColor: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        dividerWidth: 0,
        colPositions: [0, 100],
        rowPositions: [0, 60],
        cells: [
          {
            x: 0,
            y: 0,
            w: 100,
            h: 30,
            fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
            content: cellImage,
            rowIdx: 0,
            columnIdx: 0,
            rowSpan: 1,
            columnSpan: 1,
          },
          {
            x: 0,
            y: 30,
            w: 100,
            h: 30,
            fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
            content: maskedCell,
            rowIdx: 1,
            columnIdx: 0,
            rowSpan: 1,
            columnSpan: 1,
          },
        ],
      },
    } as unknown as EngineNode;

    const resources = collectEngineImageResources([table]);
    expect(resources.map((r) => r.identity).sort()).toEqual([
      'asset-aaaaaaaaaaaaaaaa',
      'data:image/png;base64,C',
    ]);
  });

  it('waits for table cell content images to settle before export', async () => {
    globalThis.Image = MockImage as unknown as typeof Image;
    MockImage.dispatch = (img) => img.onload?.();
    const cellImage = imageNode('cell1', [{ type: 'image', src: 'data:image/png;base64,TCELL' }]);
    const table = {
      id: 't1',
      name: 'table',
      transform: [1, 0, 0, 1, 0, 0],
      opacity: 1,
      blendMode: 'normal',
      shape: {
        kind: 'table',
        x: 0,
        y: 0,
        w: 100,
        h: 60,
        cornerRadius: 0,
        borderColor: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        borderWidth: 0,
        dividerColor: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        dividerWidth: 0,
        colPositions: [0, 100],
        rowPositions: [0, 60],
        cells: [
          {
            x: 0,
            y: 0,
            w: 100,
            h: 30,
            fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
            content: cellImage,
            rowIdx: 0,
            columnIdx: 0,
            rowSpan: 1,
            columnSpan: 1,
          },
        ],
      },
    } as unknown as EngineNode;

    await expect(settleEngineImageResources([table])).resolves.toEqual({ status: 'ready' });
    expect(getImageCache().isLoaded('data:image/png;base64,TCELL')).toBe(true);
  });
});

describe('settleEngineImageResources', () => {
  it('resolves ready when every resource is already loaded', async () => {
    getImageCache().setLoaded('data:image/png;base64,A', image('data:image/png;base64,A'));
    const nodes = [imageNode('n1', [{ type: 'image', src: 'data:image/png;base64,A' }])];
    await expect(settleEngineImageResources(nodes)).resolves.toEqual({ status: 'ready' });
  });

  it('waits for in-flight loads to settle', async () => {
    globalThis.Image = MockImage as unknown as typeof Image;
    MockImage.dispatch = (img) => img.onload?.();
    const nodes = [imageNode('n1', [{ type: 'image', src: 'data:image/png;base64,A' }])];
    await expect(settleEngineImageResources(nodes)).resolves.toEqual({ status: 'ready' });
  });

  it('reports typed failures for a corrupt inline resource', async () => {
    globalThis.Image = MockImage as unknown as typeof Image;
    MockImage.dispatch = (img) => img.onerror?.();
    const nodes = [imageNode('n1', [{ type: 'image', src: 'data:image/png;base64,AA==' }])];
    const result = await settleEngineImageResources(nodes);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.failures[0]!.code).toBe('corrupt');
    expect(result.failures[0]!.resource.context).toBe('n1:image-fill');
  });

  it('reports missing resources for unregistered handle-shaped identities', async () => {
    const nodes = [imageNode('n1', [{ type: 'image', src: 'asset-deadbeefdeadbeef' }])];
    const result = await settleEngineImageResources(nodes, { timeoutMs: 200 });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.failures[0]!.code).toBe('missing');
    expect(result.failures[0]!.resource.context).toBe('n1:image-fill');
  });

  it('reports pending resources on timeout instead of waiting forever', async () => {
    const nodes = [imageNode('n1', [{ type: 'image', src: 'https://slow.example.com/a.png' }])];
    const started = Date.now();
    const result = await settleEngineImageResources(nodes, { timeoutMs: 120 });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.status).toBe('timeout');
    if (result.status !== 'timeout') return;
    expect(result.pending.map((r) => r.identity)).toEqual(['https://slow.example.com/a.png']);
  });

  it('cancels cleanly when the abort signal fires', async () => {
    const nodes = [imageNode('n1', [{ type: 'image', src: 'https://slow.example.com/a.png' }])];
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const result = await settleEngineImageResources(nodes, { signal: controller.signal });
    expect(result.status).toBe('cancelled');
  });

  it('classifies a cached error entry without waiting', async () => {
    (getImageCache() as unknown as { cache: Map<string, unknown> }).cache.set(
      'https://x.example.com/m.png',
      { state: 'error', image: null, error: new Error('boom') },
    );
    const nodes = [imageNode('n1', [{ type: 'image', src: 'https://x.example.com/m.png' }])];
    const result = await settleEngineImageResources(nodes, { timeoutMs: 100 });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.failures[0]!.code).toBe('unknown');
  });

  it('distinguishes failed from pending when both exist', async () => {
    globalThis.Image = MockImage as unknown as typeof Image;
    // Inline sources fail fast; the remote source never settles, so it must
    // surface as pending on timeout.
    MockImage.dispatch = (img) => {
      if (img.src.startsWith('data:')) img.onerror?.();
    };
    const nodes = [
      imageNode('n1', [{ type: 'image', src: 'data:image/png;base64,AA==' }]),
      imageNode('n2', [{ type: 'image', src: 'https://slow.example.com/b.png' }]),
    ];
    const result = await settleEngineImageResources(nodes, { timeoutMs: 120 });
    expect(result.status).toBe('timeout');
    if (result.status !== 'timeout') return;
    expect(result.failures.map((f) => f.code)).toEqual(['corrupt']);
    expect(result.pending.map((r) => r.identity)).toEqual(['https://slow.example.com/b.png']);
  });
});

describe('recovery hints', () => {
  it('offers no meaningless retry for permanent failures', () => {
    for (const code of ['missing', 'corrupt', 'unsupported', 'cors'] as ImageErrorCode[]) {
      const hint = recoveryHintFor(code);
      expect(hint).not.toContain('Retry');
      expect(hint.length).toBeGreaterThan(0);
    }
  });

  it('suggests retry only for transient unavailability', () => {
    expect(recoveryHintFor('unavailable')).toContain('retry');
  });

  it('produces explicit export warnings naming the affected layer', () => {
    const warning = failureWarning({
      resource: {
        identity: 'data:image/png;base64,AA',
        loadable: 'data:image/png;base64,AA',
        context: 'n7:image-fill',
      },
      code: 'corrupt',
      message: 'Image failed to decode (corrupt)',
    });
    expect(warning).toContain('n7');
    expect(warning).toContain('corrupt');
  });
});
