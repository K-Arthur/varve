// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDispatch } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
}));

vi.mock('../providers/dispatch', () => ({
  dispatchBackgroundRemoval: mockDispatch,
}));

import { removeBackground } from '../index';

function makeImageData(w = 8, h = 8): ImageData {
  return new ImageData(new Uint8ClampedArray(w * h * 4), w, h);
}

const dispatched = {
  maskDataUrl: 'data:image/png;base64,mask',
  confidence: 0.9,
  method: 'ai-balanced' as const,
  processingTimeMs: 1,
  width: 8,
  height: 8,
};

describe('removeBackground AI master switch', () => {
  beforeEach(() => {
    localStorage.clear();
    mockDispatch.mockReset();
    mockDispatch.mockResolvedValue(dispatched);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('refuses AI methods before dispatch when the user switch is off', async () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
    await expect(removeBackground(makeImageData(), { method: 'ai-balanced' })).rejects.toThrow(
      'AI features are disabled',
    );
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('still dispatches the non-AI quick path when the switch is off', async () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: false } }));
    mockDispatch.mockResolvedValue({ ...dispatched, method: 'quick' });
    const result = await removeBackground(makeImageData(), { method: 'quick' });
    expect(mockDispatch).toHaveBeenCalledOnce();
    expect(result.method).toBe('quick');
  });

  it('dispatches AI methods when the switch is on', async () => {
    localStorage.setItem('varve-editor-settings', JSON.stringify({ ai: { enabled: true } }));
    await removeBackground(makeImageData(), { method: 'ai-balanced' });
    expect(mockDispatch).toHaveBeenCalledOnce();
  });
});
