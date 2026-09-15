import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computePlacementRevision,
  computeSourceFingerprint,
  resolveIsolationSource,
  type SubjectIsolationEngine,
  type SubjectIsolationRequest,
  SubjectIsolationService,
} from './SubjectIsolationService';

function makeImageData(width = 100, height = 80): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  // Fill with opaque white
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' as const };
}

function makeRequest(overrides: Partial<SubjectIsolationRequest> = {}): SubjectIsolationRequest {
  return {
    requestId: `req-${Date.now()}`,
    documentId: 'doc-1',
    nodeId: 'node-1',
    sourceFingerprint: 'fp1234567890abcdef',
    sourceLocator: 'data:image/png;base64,source',
    placementRevision: computePlacementRevision({ x: 0, y: 0, scale: 1, fit: 'fill' }),
    sourceWidth: 100,
    sourceHeight: 80,
    imageData: makeImageData(),
    options: { method: 'quick', feather: 0.5, decontaminate: true },
    ...overrides,
  };
}

function makeState(
  overrides: Record<string, unknown> = {},
): Parameters<SubjectIsolationService['isStale']>[1] {
  return {
    document: {
      id: 'doc-1',
      name: 'Test',
      formatVersion: '2.0',
      rootChildren: ['node-1'],
      nodes: {
        'node-1': {
          id: 'node-1',
          kind: 'shape',
          name: 'Image',
          shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 100 },
          fills: [
            {
              type: 'image',
              visible: true,
              opacity: 1,
              blendMode: 'normal',
              image: {
                src: 'data:image/png;base64,source',
                fit: 'fill',
                x: 0,
                y: 0,
                scale: 1,
              },
            },
          ],
          strokes: [],
          effects: [],
          transform: [1, 0, 0, 1, 0, 0],
        },
      },
      components: {},
      nextId: 10,
    },
    zoom: 1,
    pan: { x: 0, y: 0 },
    selection: ['node-1'],
    sessions: [],
    activeId: 'doc-1',
    cursorPos: null,
    unitType: 'px' as const,
    pixelGridEnabled: false,
    snapEnabled: false,
    snapGrid: 10,
    saveState: 'idle' as const,
    lastSavedAt: null,
    prototypeMode: false,
    prototypeRuntime: null,
    prototypeDebug: { entries: [] },
    prototypeData: {} as Record<string, unknown>,
    isPresenting: false,
    softProofEnabled: false,
    leftPanelVisible: true,
    rightPanelVisible: true,
    timelinePanelVisible: false,
    workspaceMode: 'design' as const,
    motion: {} as Record<string, unknown>,
    canvasMode: 'full' as const,
    cameraRotation: 0,
    rulerMode: 'global' as const,
    gridOverlayMode: 'none' as const,
    guidesVisible: true,
    selectedGuideId: null,
    currentPageId: null,
    isolatedNodeId: null,
    showOriginalBgNodeId: null,
    refineMaskOptions: { brushSize: 20, hardness: 0.5 },
    trimapEditOptions: { brushSize: 20, hardness: 0.5, penMode: 'unknown' as const },
    brushSettings: {
      presetId: 'default',
      radius: 20,
      opacity: 1,
      flow: 1,
      hardness: 0.5,
      smoothing: 0,
      spacing: 0.25,
    },
    subjectPickerSession: null,
    backgroundRemovalPreviewSession: null,
    keyObjectId: null,
    alignToPage: false,
    colorBlindnessView: 'none' as const,
    foregroundColor: [0, 0, 0, 255] as [number, number, number, number],
    backgroundColor: [255, 255, 255, 255] as [number, number, number, number],
    quickMask: {
      active: false,
      color: [255, 0, 0, 128] as [number, number, number, number],
      coverage: null,
      width: 0,
      height: 0,
    },
    dirty: false,
    tool: 'select' as const,
    ...overrides,
  } as unknown as Parameters<SubjectIsolationService['isStale']>[1];
}

// ── Fingerprint tests ────────────────────────────────────────────────────

describe('computeSourceFingerprint', () => {
  it('produces a consistent hex string for the same src', async () => {
    const a = await computeSourceFingerprint('test.png');
    const b = await computeSourceFingerprint('test.png');
    expect(a).toBe(b);
  });

  it('produces different fingerprints for different src', async () => {
    const a = await computeSourceFingerprint('img-a.png');
    const b = await computeSourceFingerprint('img-b.png');
    expect(a).not.toBe(b);
  });

  it('does not coalesce equal-sized sources when crypto is unavailable', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('unavailable'));
    try {
      const a = await computeSourceFingerprint('img-a.png', makeImageData());
      const b = await computeSourceFingerprint('img-b.png', makeImageData());
      expect(a).not.toBe(b);
    } finally {
      digest.mockRestore();
    }
  });

  it('incorporates image dimensions when ImageData provided', async () => {
    const a = await computeSourceFingerprint('img.png', makeImageData(100, 80));
    const b = await computeSourceFingerprint('img.png', makeImageData(200, 160));
    expect(a).not.toBe(b);
  });

  it('falls back when crypto is unavailable', async () => {
    const originalDigest = crypto.subtle.digest;
    // @ts-expect-error simulating unavailable crypto
    crypto.subtle.digest = undefined;
    const fp = await computeSourceFingerprint('test.png');
    crypto.subtle.digest = originalDigest;
    expect(fp).toContain('fp:');
  });
});

// ── Placement revision tests ─────────────────────────────────────────────

describe('computePlacementRevision', () => {
  it('returns 0 for null fill', () => {
    expect(computePlacementRevision(null)).toBe(0);
  });

  it('changes when x/y offset changes', () => {
    const a = computePlacementRevision({ x: 0, y: 0, scale: 1, fit: 'fill' });
    const b = computePlacementRevision({ x: 10, y: 20, scale: 1, fit: 'fill' });
    expect(a).not.toBe(b);
  });

  it('distinguishes subpixel movement, same-length fit names, crop and rotation', () => {
    expect(computePlacementRevision({ x: 0.001 })).not.toBe(computePlacementRevision({ x: 0.002 }));
    expect(computePlacementRevision({ fit: 'fill' })).not.toBe(
      computePlacementRevision({ fit: 'tile' }),
    );
    expect(computePlacementRevision({ rotation: 1 })).not.toBe(
      computePlacementRevision({ rotation: 2 }),
    );
    expect(computePlacementRevision({ crop: { x: 0, y: 0, w: 10, h: 10 } })).not.toBe(
      computePlacementRevision(null),
    );
  });

  it('changes when scale changes', () => {
    const a = computePlacementRevision({ x: 0, y: 0, scale: 1, fit: 'fit' });
    const b = computePlacementRevision({ x: 0, y: 0, scale: 2, fit: 'fit' });
    expect(a).not.toBe(b);
  });

  it('changes when fit changes', () => {
    const a = computePlacementRevision({ x: 0, y: 0, scale: 1, fit: 'fill' });
    const b = computePlacementRevision({ x: 0, y: 0, scale: 1, fit: 'cover' });
    expect(a).not.toBe(b);
  });
});

// ── Service lifecycle tests ───────────────────────────────────────────────

describe('SubjectIsolationService', () => {
  let service: SubjectIsolationService;
  let mockEngine: { removeBackground: SubjectIsolationEngine['removeBackground'] };

  beforeEach(() => {
    mockEngine = {
      removeBackground: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  maskDataUrl: 'data:image/png;base64,mockmask',
                  confidence: 0.95,
                  method: 'quick',
                  processingTimeMs: 15,
                  width: 100,
                  height: 80,
                }),
              50,
            ),
          ),
      ),
    };
    service = new SubjectIsolationService(mockEngine);
  });

  afterEach(() => {
    service.dispose();
  });

  // Intercept unhandled rejections from cancelled promises that
  // Vitest reports after the test finishes
  function silenceRejection(p: Promise<unknown>): void {
    p.catch(() => {});
  }

  it('does not start inference after cancellation during engine acquisition', async () => {
    const result = service.isolate(makeRequest());
    service.cancel();
    await expect(result).rejects.toThrow('cancelled');
    await Promise.resolve();
    expect(mockEngine.removeBackground).not.toHaveBeenCalled();
  });

  it('a cancelled request cannot clear a newer request with the same id', async () => {
    let finishFirst!: (result: unknown) => void;
    vi.mocked(mockEngine.removeBackground).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve as (result: unknown) => void;
        }),
    );
    const first = service.isolate(makeRequest({ requestId: 'same' }));
    silenceRejection(first);
    await Promise.resolve();
    const second = service.isolate(makeRequest({ requestId: 'same', sourceFingerprint: 'new' }));
    finishFirst({});
    await Promise.resolve();
    await Promise.resolve();
    expect(service.isBusy).toBe(true);
    await expect(second).resolves.toMatchObject({ maskWidth: 100 });
  });

  describe('isStale', () => {
    it('returns not stale when state matches request', () => {
      const request = makeRequest();
      const state = makeState();
      const result = service.isStale(request, state);
      expect(result.stale).toBe(false);
    });

    it('resolves shared paints instead of stale inline fills', () => {
      const state = makeState();
      const node = state.document.nodes['node-1']!;
      if (node.kind !== 'shape') throw new Error('Fixture must be a shape');
      const fill = node.fills![0]!;
      state.document.paints = { shared: { id: 'shared', name: 'Shared image', fill } };
      node.paintRefs = ['shared'];
      node.fills = [];
      expect(service.isStale(makeRequest(), state).stale).toBe(false);
    });

    it('rejects ambiguous stacked image fills', () => {
      const state = makeState();
      const node = state.document.nodes['node-1']!;
      if (node.kind !== 'shape') throw new Error('Fixture must be a shape');
      node.fills = [node.fills![0]!, node.fills![0]!];
      expect(resolveIsolationSource(state.document, node.id)).toBeNull();
      expect(service.isStale(makeRequest(), state).stale).toBe(true);
    });

    it('rejects a changed immutable source even when its locator is unchanged', () => {
      const state = makeState();
      const source = resolveIsolationSource(state.document, 'node-1')!;
      const request = makeRequest({ sourceIdentity: source });
      source.node.fills = [{ ...source.node.fills![0]!, image: { ...source.image } }];
      expect(service.isStale(request, state)).toEqual({
        stale: true,
        reason: 'source-pixels-changed',
      });
    });

    it('retains a source-space result across unrelated document edits', () => {
      const state = makeState();
      const source = resolveIsolationSource(state.document, 'node-1')!;
      const request = makeRequest({ sourceIdentity: source });
      state.document = { ...state.document, name: 'An unrelated rename' };
      expect(service.isStale(request, state).stale).toBe(false);
    });

    it('rejects when document switched', () => {
      const request = makeRequest({ documentId: 'doc-a' });
      const state = makeState({ document: { id: 'doc-b' } } as unknown as Record<string, unknown>);
      const result = service.isStale(request, state);
      expect(result.stale).toBe(true);
      expect(result.reason).toBe('document-switched');
    });

    it('rejects when node deleted', () => {
      const request = makeRequest({ nodeId: 'node-gone' });
      const state = makeState();
      const result = service.isStale(request, state);
      expect(result.stale).toBe(true);
      expect(result.reason).toBe('node-deleted');
    });

    it('rejects when node kind changed (node replaced)', () => {
      const request = makeRequest({ nodeId: 'node-1' });
      const state = makeState({
        document: {
          id: 'doc-1',
          nodes: {
            'node-1': { id: 'node-1', kind: 'text', name: 'Text', transform: [1, 0, 0, 1, 0, 0] },
          },
        },
      });
      const result = service.isStale(request, state);
      expect(result.stale).toBe(true);
      expect(result.reason).toBe('node-deleted');
    });

    it('rejects when the processed image is no longer selected', () => {
      const result = service.isStale(makeRequest(), makeState({ selection: [] }));
      expect(result).toEqual({ stale: true, reason: 'not-selected' });
    });

    it('rejects when the image source is replaced under the same node id', () => {
      const state = makeState();
      const node = state.document.nodes['node-1']!;
      node.fills![0]!.image!.src = 'data:image/png;base64,replacement';
      const result = service.isStale(makeRequest(), state);
      expect(result).toEqual({ stale: true, reason: 'source-replaced' });
    });
  });

  describe('isolate', () => {
    it('coalesces identical requests in flight', async () => {
      const req1 = makeRequest();
      const p1 = service.isolate(req1);
      silenceRejection(p1);

      // Before the first resolves, a request with the same identity
      // fields should coalesce. isolate() sets currentRequest synchronously
      // before returning.
      const req2 = makeRequest({
        sourceFingerprint: req1.sourceFingerprint,
        placementRevision: req1.placementRevision,
        documentId: req1.documentId,
        nodeId: req1.nodeId,
      });
      const p2 = service.isolate(req2);
      silenceRejection(p2);

      expect(p1).toBe(p2);
      service.cancel();
    });

    it('starts a new request when fields differ', async () => {
      const req1 = makeRequest({ sourceFingerprint: 'fp-one' });
      const p1 = service.isolate(req1);
      silenceRejection(p1);

      const req2 = makeRequest({ sourceFingerprint: 'fp-two' });
      const p2 = service.isolate(req2);
      silenceRejection(p2);

      expect(p1).not.toBe(p2);
    });

    it('does not coalesce requests for different quality or refinement options', () => {
      const p1 = service.isolate(makeRequest());
      silenceRejection(p1);
      const p2 = service.isolate(
        makeRequest({ options: { method: 'ai-balanced', feather: 1, decontaminate: false } }),
      );
      silenceRejection(p2);
      expect(p1).not.toBe(p2);
    });
  });

  describe('cancel', () => {
    it('cancels in-flight request', async () => {
      const promise = service.isolate(makeRequest());
      service.cancel();
      await expect(promise).rejects.toThrow('cancelled');
    });

    it('settles after cancel', async () => {
      silenceRejection(service.isolate(makeRequest()));
      service.cancel();
      expect(service.isBusy).toBe(false);
    });

    it('cancels inference when the caller aborts its operation signal', async () => {
      const controller = new AbortController();
      const promise = service.isolate(makeRequest(), controller.signal);
      controller.abort();
      await expect(promise).rejects.toThrow('cancelled');
      expect(service.isBusy).toBe(false);
    });
  });

  describe('dispose', () => {
    it('cancels and cleans up', async () => {
      const p = service.isolate(makeRequest());
      service.dispose();
      await expect(p).rejects.toThrow('cancelled');
      expect(service.isBusy).toBe(false);
    });
  });
});
