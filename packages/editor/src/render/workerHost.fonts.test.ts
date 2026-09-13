import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { harvestDocumentFontFaces } = vi.hoisted(() => ({
  harvestDocumentFontFaces: vi.fn(),
}));

vi.mock('./workerFonts', async () => {
  const actual = await vi.importActual<typeof import('./workerFonts')>('./workerFonts');
  return { ...actual, harvestDocumentFontFaces };
});

import { createRenderWorkerHost } from './workerHost';
import type { WorkerFontFace } from './workerFonts';

const face: WorkerFontFace = {
  family: 'Exact Sans',
  source: 'url(data:font/woff2;base64,AAAA)',
  weight: '400',
  style: 'normal',
  faceKey: `sha256:${'a'.repeat(64)}:single`,
  revision: 'Exact Sans:1',
};

const mockWorkers: MockWorker[] = [];

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(_url: URL | string, _options?: WorkerOptions) {
    mockWorkers.push(this);
  }
}

describe('render worker font adoption gate', () => {
  beforeEach(() => {
    mockWorkers.length = 0;
    harvestDocumentFontFaces.mockReturnValue([face]);
    (globalThis as unknown as { Worker: typeof MockWorker }).Worker = MockWorker;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { Worker?: typeof MockWorker }).Worker;
  });

  it('keeps the worker unavailable until the current face-set acknowledgement arrives', () => {
    const host = createRenderWorkerHost(vi.fn());
    expect(host).not.toBeNull();

    const worker = mockWorkers[0]!;
    const fontCommand = worker.postMessage.mock.calls
      .map(([message]) => message as { type?: string; key?: string; faces?: WorkerFontFace[] })
      .find((message) => message.type === 'fonts');
    expect(fontCommand?.faces).toEqual([face]);
    expect(fontCommand?.key).toBeTruthy();
    expect(host!.fontsReady).toBe(false);
    expect([...host!.unavailableFontFamilies]).toEqual(['Exact Sans']);

    worker.onmessage?.({
      data: { type: 'fontsAdopted', key: 'fonts:stale', families: ['Exact Sans'] },
    } as MessageEvent);
    expect(host!.fontsReady).toBe(false);
    expect([...host!.unavailableFontFamilies]).toEqual(['Exact Sans']);

    worker.onmessage?.({
      data: { type: 'fontsAdopted', key: fontCommand!.key, families: [] },
    } as MessageEvent);
    expect(host!.fontsReady).toBe(true);
    expect([...host!.unavailableFontFamilies]).toEqual(['Exact Sans']);

    worker.onmessage?.({
      data: { type: 'fontsAdopted', key: fontCommand!.key, families: ['Exact Sans'] },
    } as MessageEvent);
    expect(host!.fontsReady).toBe(true);
    expect(host!.unavailableFontFamilies.size).toBe(0);

    host!.terminate();
  });
});
