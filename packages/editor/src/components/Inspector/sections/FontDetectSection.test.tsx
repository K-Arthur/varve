import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createFontCatalogFromRegistry,
  detectFont,
  getModelLoader,
  loadFullLabelMap,
  renderAndCompare,
} from '@varve/engine';
import { makeImageShapeNode } from '@varve/scene';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../../context';
import { FontDetectSection } from './FontDetectSection';

vi.mock('../../../context', () => ({
  useEditor: vi.fn(),
}));

vi.mock('@varve/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/engine')>();
  return {
    ...actual,
    createFontCatalogFromRegistry: vi.fn(() => ({})),
    detectFont: vi.fn(),
    fontReferenceFromIdentity: vi.fn(),
    getFontRegistry: vi.fn(() => ({})),
    getModelLoader: vi.fn(),
    loadFullLabelMap: vi.fn(),
    renderAndCompare: vi.fn(),
  };
});

vi.mock('../controls/DisclosureSection', () => ({
  DisclosureSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

vi.mock('@varve/ui', () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

const image = makeImageShapeNode('image-1', {
  src: 'data:image/png;base64,fixture',
  w: 320,
  h: 180,
});

const croppedImageBase = makeImageShapeNode('image-crop', {
  src: 'data:image/png;base64,fixture',
  w: 320,
  h: 180,
});
const croppedImage = {
  ...croppedImageBase,
  fills: croppedImageBase.fills?.map((fill) =>
    fill.type === 'image' && fill.image
      ? {
          ...fill,
          image: { ...fill.image, crop: { x: 8, y: 4, w: 120, h: 64 }, rotation: 12, flipH: true },
        }
      : fill,
  ),
};

const announce = vi.fn();
const setPendingFormat = vi.fn();
const setTool = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getModelLoader).mockReturnValue({
    isModelAvailable: vi.fn(async () => false),
    downloadModel: vi.fn(),
  } as never);
  vi.mocked(loadFullLabelMap).mockResolvedValue([] as never);
  vi.mocked(renderAndCompare).mockResolvedValue({
    scores: new Map(),
    details: new Map(),
    failedFamilies: [],
  });
  vi.mocked(detectFont).mockResolvedValue({
    status: 'success',
    candidates: [
      {
        rank: 0,
        family: 'Inter',
        style: 'Regular',
        confidenceCategory: 'plausible-match',
        confidenceScore: 0.72,
        matchType: 'similar-installed',
        isAvailable: true,
        source: 'system',
      },
    ],
    features: null,
    message: 'Found 1 candidate',
    elapsedMs: 2,
    usedClassifier: false,
    resolvedMode: 'local-match',
    qualityWarnings: [],
  });
  vi.mocked(useEditor).mockReturnValue({
    announce,
    setPendingFormat,
    setTool,
  } as never);

  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 32;
      naturalHeight = 16;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    save: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    restore: vi.fn(),
    getImageData: () => new ImageData(32, 16),
  } as never);
});

describe('FontDetectSection', () => {
  it('passes the local catalog/comparison adapter and manual text to detection', async () => {
    render(<FontDetectSection nodes={[image]} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Text in image (optional)' }), {
      target: { value: 'Sample text' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Identify font in image' }));

    await waitFor(() => expect(screen.getByText('Inter')).toBeInTheDocument());
    expect(createFontCatalogFromRegistry).toHaveBeenCalledOnce();
    expect(detectFont).toHaveBeenCalledWith(
      expect.objectContaining({ recognizedText: 'Sample text' }),
      expect.objectContaining({
        fontCatalog: expect.anything(),
        renderCompare: expect.any(Function),
      }),
    );
  });

  it('queues a candidate for new text instead of pretending to edit the image', async () => {
    render(<FontDetectSection nodes={[image]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Identify font in image' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Use Inter for new text' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use Inter for new text' }));
    expect(setPendingFormat).toHaveBeenCalledWith({ fontFamily: 'Inter' });
    expect(setTool).toHaveBeenCalledWith('text');
    expect(announce).toHaveBeenCalledWith('Font selected for new text: Inter');
  });

  it('uses the existing visible crop and offers transformed canvas-region selection', async () => {
    render(<FontDetectSection nodes={[croppedImage]} />);

    expect(screen.getByText('120 x 64 px')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Analyze visible crop' })).toBeChecked();
    expect(screen.getByText(/follows the image transform/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Identify font in image' }));
    await waitFor(() => expect(screen.getByText('Inter')).toBeInTheDocument());
    expect(detectFont).toHaveBeenCalledWith(
      expect.objectContaining({ imageData: expect.any(ImageData) }),
      expect.anything(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select region on canvas' }));
    expect(setTool).toHaveBeenCalledWith('crop');
    expect(announce).toHaveBeenCalledWith(
      'Crop tool active. Select the text region, then return to Identify Font.',
    );
  });
});
