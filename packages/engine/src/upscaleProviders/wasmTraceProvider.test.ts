/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tryLoadTraceWasmMock } = vi.hoisted(() => ({
  tryLoadTraceWasmMock: vi.fn(),
}));

vi.mock('../wasmLoader', () => ({
  tryLoadTraceWasm: tryLoadTraceWasmMock,
}));

describe('wasmTraceProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    tryLoadTraceWasmMock.mockReset();
  });

  it('passes fitting and simplification settings through the extended WASM facade', async () => {
    const traceWithOptions = vi.fn(
      (
        _pixels: Uint8Array,
        _width: number,
        _height: number,
        _threshold: number,
        _minPixels: number,
        _foreground: string | undefined,
        _optionsJson: string,
      ) =>
        JSON.stringify({
          width: 2,
          height: 2,
          omittedHoles: 0,
          paths: [
            {
              points: [{ x: 0, y: 0, handleIn: [-1, 0], handleOut: [1, 0] }],
              closed: true,
              area: 1,
              bounds: { x: 0, y: 0, w: 1, h: 1 },
              curveFitted: true,
            },
          ],
        }),
    );
    tryLoadTraceWasmMock.mockResolvedValue({
      trace_contours_json: vi.fn(),
      trace_contours_json_opts: traceWithOptions,
      wasm_trace_version: () => 'test',
    });
    const { wasmTraceProvider } = await import('./wasmTraceProvider');

    const result = await wasmTraceProvider.trace(new ImageData(2, 2), {
      simplifyTolerance: 1.5,
      cornerAngle: 150,
      maxError: 0.5,
    });

    const options = JSON.parse(traceWithOptions.mock.calls[0]?.[6] ?? '{}');
    expect(options).toEqual({ cornerAngle: 150, maxError: 0.5, simplifyTolerance: 1.5 });
    expect(result.paths[0]?.curveFitted).toBe(true);
    expect(result.paths[0]?.points[0]).toEqual({
      x: 0,
      y: 0,
      handleIn: [-1, 0],
      handleOut: [1, 0],
    });
  });
});
