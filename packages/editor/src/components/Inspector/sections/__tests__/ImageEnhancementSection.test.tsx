// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../context', () => ({ useEditor: vi.fn() }));

import { useEditor } from '../../../../context';
import { ImageEnhancementSection } from '../ImageEnhancementSection';

const mockedUseEditor = useEditor as unknown as ReturnType<typeof vi.fn>;

function imageNode() {
  return {
    id: 'image-1',
    kind: 'shape' as const,
    name: 'Logo',
    shape: { kind: 'rect' as const, x: 0, y: 0, w: 20, h: 10 },
    fills: [
      {
        type: 'image' as const,
        image: { src: 'data:image/png;base64,AAAA', fit: 'fill' as const, x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal' as const,
        visible: true,
      },
    ],
    transform: [1, 0, 0, 1, 0, 0] as const,
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 0 },
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal' as const,
    rotation: 0,
    strokes: [],
    effects: [],
    order: 'a0',
  };
}

describe('ImageEnhancementSection', () => {
  const upscaleSelectedImage = vi.fn().mockResolvedValue(undefined);
  const traceSelectedImage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    upscaleSelectedImage.mockClear();
    traceSelectedImage.mockClear();
    mockedUseEditor.mockReturnValue({
      upscaleSelectedImage,
      traceSelectedImage,
      cancelImageProcessing: vi.fn(),
      announce: vi.fn(),
    });
  });

  afterEach(cleanup);

  it('dispatches configured upscale and trace operations for image-filled shapes', async () => {
    render(<ImageEnhancementSection nodes={[imageNode()]} />);

    expect(screen.getByText(/Processing runs locally/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Upscale factor'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Upscale method'), { target: { value: 'nearest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upscale image' }));

    await waitFor(() =>
      expect(upscaleSelectedImage).toHaveBeenCalledWith({
        scale: 4,
        method: 'nearest',
      }),
    );

    fireEvent.change(screen.getByLabelText('Trace mode'), { target: { value: 'color' } });
    fireEvent.change(screen.getByLabelText('Trace color count'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Minimum trace area'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trace color' }));

    await waitFor(() =>
      expect(traceSelectedImage).toHaveBeenCalledWith({
        mode: 'color',
        threshold: 128,
        maxColors: 6,
        foreground: 'dark',
        minArea: 3,
        simplifyTolerance: 0.75,
      }),
    );
  });

  it('offers bundled Real-ESRGAN and dispatches its fixed 4x model', async () => {
    render(<ImageEnhancementSection nodes={[imageNode()]} />);
    const options = screen.getByLabelText('Upscale method').querySelectorAll('option');
    const values = [...options].map((o) => (o as HTMLOptionElement).value);
    expect(values).toContain('ai');

    fireEvent.change(screen.getByLabelText('Upscale method'), { target: { value: 'ai' } });
    expect(screen.getByLabelText('Upscale factor')).toHaveValue('4');
    expect(screen.getByLabelText('Upscale factor')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Upscale image' }));

    await waitFor(() =>
      expect(upscaleSelectedImage).toHaveBeenCalledWith({
        scale: 4,
        method: 'ai',
        modelId: 'upscale-realesr-general',
      }),
    );
  });

  it('does not render for non-image nodes', () => {
    const node = { ...imageNode(), fills: [] };
    const { container } = render(<ImageEnhancementSection nodes={[node]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
