// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { type Adjustment, adjustmentDefaults } from '@varve/engine';
import type { EffectDispatchRequest, EffectPreviewIdentity } from '@varve/engine/liveEffects';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEffectKernelSample, EffectKernelPreview } from './EffectKernelPreview';

const { submit, cancelOwner } = vi.hoisted(() => ({
  submit: vi.fn(),
  cancelOwner: vi.fn(),
}));

vi.mock('@varve/engine/liveEffects', () => ({
  getEffectPreviewRunner: () => ({ submit, cancelOwner }),
  sameEffectPreviewIdentity: (left: EffectPreviewIdentity, right: EffectPreviewIdentity) =>
    JSON.stringify(left) === JSON.stringify(right),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('EffectKernelPreview', () => {
  it('creates a deterministic transparent-detail sample surface', () => {
    const first = createEffectKernelSample();
    const second = createEffectKernelSample();
    expect(first).toEqual(second);
    expect(first).toHaveLength(112 * 72 * 4);
    expect(first.some((value) => value < 255)).toBe(true);
  });

  it('submits the current effect to the shared worker lane and labels the sample clearly', async () => {
    const pixels = createEffectKernelSample();
    submit.mockImplementation(
      async (input: {
        identity: EffectPreviewIdentity;
        request: EffectDispatchRequest;
        captureSource: () => Uint8ClampedArray;
        isCurrent: (identity: EffectPreviewIdentity) => boolean;
      }) => {
        expect(input.request.effect).toBe('dither');
        expect(input.isCurrent(input.identity)).toBe(true);
        expect(input.captureSource()).toEqual(pixels);
        return pixels;
      },
    );
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData,
    } as never);
    vi.stubGlobal(
      'ImageData',
      class {
        readonly data: Uint8ClampedArray;
        readonly width: number;
        readonly height: number;
        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      },
    );

    render(
      <EffectKernelPreview
        adjustment={
          {
            ...adjustmentDefaults('dither'),
            id: 'effect-1',
            kind: 'dither',
          } as Adjustment
        }
      />,
    );

    expect(
      screen.getByRole('img', { name: 'Sample output for dither; not the selected artwork' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Kernel sample')).toBeInTheDocument();
    expect(await screen.findByText('Kernel sample ready')).toBeInTheDocument();
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(putImageData).toHaveBeenCalledTimes(1);
    expect(putImageData.mock.calls[0]?.[0]).toMatchObject({ width: 112, height: 72 });
  });

  it('keeps the artwork-path disclosure when the preview worker is unavailable', async () => {
    submit.mockRejectedValue(new Error('worker unavailable'));
    render(
      <EffectKernelPreview
        adjustment={
          {
            ...adjustmentDefaults('crt'),
            id: 'effect-2',
            kind: 'crt',
          } as Adjustment
        }
      />,
    );

    expect(
      await screen.findByText('Sample unavailable; the canvas remains the artwork preview.'),
    ).toBeInTheDocument();
  });
});
