// @vitest-environment jsdom
/**
 * TextDiscoveryPanel contract tests.
 *
 * The real-model browser gate for this panel is resource-scheduled (it needs a
 * 2.4 GB-class detector allocation), so the panel's *states* are pinned here:
 * a refusal must be distinguishable from a failure, the timing row must show
 * the whole decomposition including the total, and cancelling must return the
 * search form and hand the detector back for release.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockIsModelAvailable,
  mockGetModelLoaderReady,
  mockGetModelPath,
  mockLoad,
  mockInfer,
  mockReleaseModel,
  mockRecycleWorkerIfIdle,
  mockGetModelById,
} = vi.hoisted(() => ({
  mockIsModelAvailable: vi.fn(),
  mockGetModelLoaderReady: vi.fn(),
  mockGetModelPath: vi.fn(),
  mockLoad: vi.fn(),
  mockInfer: vi.fn(),
  mockReleaseModel: vi.fn(),
  mockRecycleWorkerIfIdle: vi.fn(),
  mockGetModelById: vi.fn(),
}));

vi.mock('@varve/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/engine')>();
  return {
    ...actual,
    GROUNDING_DINO_MODEL_ID: 'grounding-dino-tiny',
    GROUNDING_DINO_TOKENIZER_ID: 'grounding-dino-tokenizer',
    GROUNDING_DINO_INPUT_SIZE: 8,
    GROUNDING_DINO_MODEL_IMAGE_PREPROCESSING_VERSION: 'test-v2',
    getModelLoaderReady: mockGetModelLoaderReady,
    getModelById: mockGetModelById,
    getImageCache: () => ({ load: mockLoad }),
    getInferenceWorkerHost: () => ({
      infer: mockInfer,
      releaseModel: mockReleaseModel,
      recycleWorkerIfIdle: mockRecycleWorkerIfIdle,
    }),
    estimateInferenceReservation: () => 2_600_000_000,
    bertTokenize: () => ({ ids: [101, 102], tokens: ['[CLS]', '[SEP]'] }),
    locatePhraseSpans: () => [{ start: 0, end: 1 }],
    normalizeGroundingQuery: (query: string) => ({
      normalized: query.trim().toLowerCase(),
      phrases: query.trim() ? [query.trim().toLowerCase()] : [],
    }),
    parseBertVocab: () => new Map(),
    decodeGroundingDinoOutput: () => [
      {
        id: 'det-1',
        phrase: 'apple',
        phraseIndex: 0,
        score: 0.76,
        box: { x1: 10, y1: 20, x2: 40, y2: 60 },
        normalizedBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.6 },
      },
    ],
    buildGroundingDinoInputsFromModelImage: () => ({
      pixel_values: { data: new Float32Array(8 * 8 * 3), dims: [1, 3, 8, 8] },
      input_ids: { data: new BigInt64Array(4), dims: [1, 4], dtype: 'int64' },
      token_type_ids: { data: new BigInt64Array(4), dims: [1, 4], dtype: 'int64' },
      attention_mask: { data: new BigInt64Array(4), dims: [1, 4], dtype: 'int64' },
      pixel_mask: { data: new BigInt64Array(8 * 8), dims: [1, 8, 8], dtype: 'int64' },
    }),
  };
});

import { TextDiscoveryPanel } from './TextDiscoveryPanel';

const announce = vi.fn();
const onSegmentBox = vi.fn();

function renderPanel() {
  return render(
    <TextDiscoveryPanel source="/photo.jpg" onSegmentBox={onSegmentBox} announce={announce} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetModelLoaderReady.mockResolvedValue({
    isModelAvailable: mockIsModelAvailable,
    getModelPath: mockGetModelPath,
    downloadModel: vi.fn(),
    subscribe: () => () => undefined,
  });
  mockIsModelAvailable.mockResolvedValue(true);
  mockGetModelPath.mockResolvedValue('/models/grounding-dino/model_int8.onnx');
  mockRecycleWorkerIfIdle.mockReturnValue(false);
  mockGetModelById.mockReturnValue({ peakMemoryBytes: 2_600_000_000 });
  // Minimal canvas + image + fetch surface for the browser preprocessing path.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));
  vi.stubGlobal(
    'HTMLCanvasElement',
    class {
      width = 0;
      height = 0;
      getContext() {
        return {
          imageSmoothingEnabled: false,
          imageSmoothingQuality: 'high',
          drawImage: vi.fn(),
          getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4),
            width: w,
            height: h,
          }),
        };
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TextDiscoveryPanel', () => {
  it('shows the install offer while the detector is missing and never runs it implicitly', async () => {
    mockIsModelAvailable.mockResolvedValue(false);
    renderPanel();
    expect(
      await screen.findByRole('button', { name: /Install text discovery model/i }),
    ).toBeTruthy();
    expect(mockInfer).not.toHaveBeenCalled();
  });

  it('reports the full timing breakdown, including the total, after a completed run', async () => {
    mockLoad.mockResolvedValue({ width: 800, height: 800 });
    mockInfer.mockResolvedValue({
      outputs: {
        logits: { data: new Float32Array(900 * 256), dims: [1, 900, 256] },
        pred_boxes: { data: new Float32Array(900 * 4), dims: [1, 900, 4] },
      },
      timings: { sessionMs: 0, preprocessMs: 12, inferMs: 41900, postprocessMs: 3 },
    });
    mockReleaseModel.mockResolvedValue({ released: ['grounding-dino'], failed: [], inUse: [] });
    renderPanel();
    const query = await screen.findByLabelText('Description');
    fireEvent.change(query, { target: { value: 'apple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find regions' }));

    const timings = await screen.findByTestId('text-discovery-timings');
    expect(timings.textContent).toMatch(/model load warm/);
    expect(timings.textContent).toMatch(/image prep/);
    expect(timings.textContent).toMatch(/tensor build/);
    expect(timings.textContent).toMatch(/detection/);
    expect(timings.textContent).toMatch(/release/);
    expect(timings.textContent).toMatch(/total/);
    expect(mockReleaseModel).toHaveBeenCalledWith(
      'grounding-dino',
      '/models/grounding-dino/model_int8.onnx',
    );
  });

  it('shows an admission refusal as a refusal with the budget detail, not as a failure', async () => {
    mockLoad.mockResolvedValue({ width: 800, height: 800 });
    mockInfer.mockRejectedValue(
      new Error(
        'Model exceeds safe WASM memory limit. Needs about 2.6 GB, more than this session’s 1.2 GB budget. The budget is raised by cross-origin isolation, which this page does not have.',
      ),
    );
    renderPanel();
    fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'apple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find regions' }));

    const refusal = await screen.findByTestId('text-discovery-refusal');
    expect(refusal.textContent).toMatch(/cross-origin isolation/);
    expect(refusal.textContent).not.toMatch(/safe WASM memory limit/);
    expect(screen.queryByTestId('text-discovery-error')).toBeNull();
  });

  it('returns to the search form and releases the detector when the run is cancelled', async () => {
    mockLoad.mockResolvedValue({ width: 800, height: 800 });
    let rejectInfer: ((error: Error) => void) | undefined;
    mockInfer.mockImplementation(
      (_request: unknown, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          rejectInfer = reject;
          options.signal.addEventListener('abort', () => reject(new Error('cancelled')));
        }),
    );
    mockReleaseModel.mockResolvedValue({ released: [], failed: [], inUse: ['grounding-dino'] });
    renderPanel();
    fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'apple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find regions' }));
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    fireEvent.click(cancel);

    // Back to the search form: the install offer must not appear for an
    // installed model.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Find regions' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Install text discovery model/i })).toBeNull();
    // The idle-only release path is used; it may report the graph as in use.
    await waitFor(() =>
      expect(mockReleaseModel).toHaveBeenCalledWith(
        'grounding-dino',
        '/models/grounding-dino/model_int8.onnx',
      ),
    );
    rejectInfer?.(new Error('cancelled'));
    expect(announce).toHaveBeenCalledWith('Text discovery cancelled.');
  });
});
