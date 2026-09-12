import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  sessions: [] as Array<{
    run: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  }>,
  runFails: false,
}));

vi.mock('onnxruntime-web', () => {
  class FakeTensor {
    constructor(
      readonly type: string,
      readonly data: ArrayLike<number>,
      readonly dims: number[],
    ) {}
    dispose(): void {}
  }
  return {
    InferenceSession: {
      create: vi.fn(async () => {
        const session = {
          run: vi.fn(async () => {
            if (state.runFails) throw new Error('inference failed');
            return {};
          }),
          release: vi.fn(async () => {}),
          inputNames: ['input'],
          outputNames: ['output'],
        };
        state.sessions.push(session);
        return session;
      }),
    },
    Tensor: FakeTensor,
    env: { wasm: { wasmPaths: '' } },
  };
});

vi.mock('./modelManifest', () => ({
  getManifestEntry: vi.fn(async (id: string) => ({ localPath: `/models/${id}.onnx` })),
}));

import { runPrecisionBenchmark } from './precisionCapabilities';

describe('runPrecisionBenchmark session cleanup', () => {
  beforeEach(() => {
    state.sessions.length = 0;
    state.runFails = false;
    let tick = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (tick += 1));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('releases both sessions when a benchmark run fails', async () => {
    state.runFails = true;

    await expect(runPrecisionBenchmark('wasm')).resolves.toBeNull();

    expect(state.sessions).toHaveLength(2);
    for (const session of state.sessions) {
      expect(session.release).toHaveBeenCalledTimes(1);
    }
  });

  it('releases both sessions on the measured path', async () => {
    await expect(runPrecisionBenchmark('wasm')).resolves.toEqual({
      speedup: expect.any(Number),
      fp32Ms: expect.any(Number),
      int8Ms: expect.any(Number),
    });

    expect(state.sessions).toHaveLength(2);
    for (const session of state.sessions) {
      expect(session.release).toHaveBeenCalledTimes(1);
    }
  });
});
