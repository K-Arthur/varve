import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createFontCatalogFromRegistry,
  detectFont,
  getModelLoader,
  loadFullLabelMap,
  renderAndCompare,
} from '@varve/engine';
import { makeImageShapeNode, makeTextNode } from '@varve/scene';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../../context';
import { FontDetectSection } from './FontDetectSection';
import { hasLocalFontOcr, recognizeFontTextLocally } from './fontOcr';

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
  // The section previously rendered a native <select>; the shared Select is
  // the canonical control. The mock keeps the same test-facing semantics
  // (label + options + onChange) without pulling the floating-layer runtime
  // into jsdom.
  Select: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value?: string;
    options?: { value: string; label: string }[];
    onChange?: (value: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange?.(event.target.value)}>
      {(options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('./fontOcr', () => ({
  averageOcrConfidence: (result: { words: Array<{ text: string; confidence: number }> }) => {
    const words = result.words.filter((word) => word.text.trim());
    return words.length > 0
      ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length
      : undefined;
  },
  hasLocalFontOcr: vi.fn(),
  recognizeFontTextLocally: vi.fn(),
  textFromOcrResult: (result: { words: Array<{ text: string }> }) =>
    result.words
      .map((word) => word.text.trim())
      .filter(Boolean)
      .join(' ')
      .trim(),
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
const groupCompoundOperation = vi.fn((_label: string, action: () => void) => action());
const updateNode = vi.fn();
const setSelection = vi.fn();
const textTarget = makeTextNode('text-target', 'Editable target', { name: 'Headline' });
const hiddenTextTarget = {
  ...makeTextNode('hidden-target', 'Hidden target', { name: 'Hidden headline' }),
  visible: false,
};
const lockedTextTarget = {
  ...makeTextNode('locked-target', 'Locked target', { name: 'Locked headline' }),
  locked: true,
};
const ocrResult = {
  words: [
    {
      x: 4,
      y: 8,
      width: 120,
      height: 24,
      detectionConfidence: 0.96,
      text: 'Sample',
      confidence: 0.9,
      charConfidences: [0.9],
    },
    {
      x: 132,
      y: 8,
      width: 100,
      height: 24,
      detectionConfidence: 0.94,
      text: 'text',
      confidence: 0.8,
      charConfidences: [0.8],
    },
  ],
  executionProvider: 'wasm',
  processingTimeMs: 24,
  dictionaryAvailable: true,
  recognitionModelId: 'tr-ocr-base-printed',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getModelLoader).mockReturnValue({
    isModelAvailable: vi.fn(async () => false),
    downloadModel: vi.fn(),
  } as never);
  vi.mocked(loadFullLabelMap).mockResolvedValue([] as never);
  vi.mocked(hasLocalFontOcr).mockResolvedValue(false);
  vi.mocked(recognizeFontTextLocally).mockResolvedValue(ocrResult);
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
    // The section renders through the registry DisclosureSection; seed the
    // collapsed-by-default state expanded so its content mounts.
    state: { sectionVisibility: { 'font-detect': { collapsed: false } } },
    toggleSectionCollapse: vi.fn(),
    toggleSubSectionCollapse: vi.fn(),
    hideInspectorSection: vi.fn(),
    walkNodes: () =>
      new Map([
        ['text-target', { nodeId: 'text-target', node: textTarget, parentId: null, depth: 0 }],
        [
          'hidden-target',
          { nodeId: 'hidden-target', node: hiddenTextTarget, parentId: null, depth: 0 },
        ],
        [
          'locked-target',
          { nodeId: 'locked-target', node: lockedTextTarget, parentId: null, depth: 0 },
        ],
      ]),
    groupCompoundOperation,
    updateNode,
    setSelection,
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
    expect(screen.getByRole('img', { name: 'Preview Inter' })).toHaveTextContent('Sample text');
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

  it('applies a reviewed candidate to an explicitly chosen text target', async () => {
    render(<FontDetectSection nodes={[image]} />);
    expect(screen.queryByRole('option', { name: /Hidden headline/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Locked headline/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Existing text target' }), {
      target: { value: 'text-target' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Identify font in image' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Apply Inter to existing text target' }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply Inter to existing text target' }));
    expect(groupCompoundOperation).toHaveBeenCalledWith(
      'Apply identified font',
      expect.any(Function),
    );
    expect(updateNode).toHaveBeenCalledWith('text-target', expect.any(Function));
    expect(setSelection).toHaveBeenCalledWith('text-target');
    expect(announce).toHaveBeenCalledWith('Applied Inter to Headline');

    const updater = vi.mocked(updateNode).mock.calls[0]?.[1] as (
      node: typeof textTarget,
    ) => typeof textTarget;
    expect(updater(textTarget)).toMatchObject({ fontFamily: 'Inter', fontReference: undefined });
  });

  it('uses installed local OCR to fill editable text and reports confidence', async () => {
    vi.mocked(hasLocalFontOcr).mockResolvedValue(true);
    render(<FontDetectSection nodes={[image]} />);

    const ocrButton = await screen.findByRole('button', { name: 'Recognize text locally' });
    fireEvent.click(ocrButton);

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Text in image (optional)' })).toHaveValue(
        'Sample text',
      ),
    );
    expect(recognizeFontTextLocally).toHaveBeenCalledWith(
      expect.any(ImageData),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/average confidence 85%/i);
    expect(announce).toHaveBeenCalledWith('Local OCR recognized 2 text regions');
  });

  it('lets the user select OCR regions before comparing fonts', async () => {
    vi.mocked(hasLocalFontOcr).mockResolvedValue(true);
    render(<FontDetectSection nodes={[image]} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Recognize text locally' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /OCR region 1: Sample/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /OCR region 1: Sample/ }));
    expect(screen.getByRole('textbox', { name: 'Text in image (optional)' })).toHaveValue('text');
    expect(screen.getByText(/1\s*\/\s*2\s*selected/)).toBeInTheDocument();
    expect(announce).toHaveBeenCalledWith('Excluded OCR region 1');
  });

  it('requires review of a low-confidence target preview before applying', async () => {
    vi.mocked(detectFont).mockResolvedValueOnce({
      status: 'low-confidence',
      candidates: [
        {
          rank: 0,
          family: 'Unknown Sans',
          style: 'Regular',
          confidenceCategory: 'low-confidence',
          confidenceScore: 0.21,
          matchType: 'unknown',
          isAvailable: false,
          source: 'unknown',
        },
      ],
      features: null,
      message: 'Low confidence',
      elapsedMs: 2,
      usedClassifier: true,
      resolvedMode: 'classifier',
      qualityWarnings: [],
    });
    render(<FontDetectSection nodes={[image]} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Existing text target' }), {
      target: { value: 'text-target' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Identify font in image' }));

    await waitFor(() => expect(screen.getByText('Preview on Headline')).toBeInTheDocument());
    const apply = screen.getByRole('button', {
      name: 'Apply Unknown Sans to existing text target',
    });
    expect(apply).toBeDisabled();
    expect(screen.getByText(/Confidence is low/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review preview' }));
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(groupCompoundOperation).toHaveBeenCalledWith(
      'Apply identified font',
      expect.any(Function),
    );
  });

  it('keeps manual entry available when local OCR assets are missing', async () => {
    render(<FontDetectSection nodes={[image]} />);

    expect(
      await screen.findByText('Local OCR models are unavailable in this runtime.'),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Text in image (optional)' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Recognize text locally' }),
    ).not.toBeInTheDocument();
  });

  it('keeps classifier detection available when OCR availability probing fails', async () => {
    vi.mocked(getModelLoader).mockReturnValue({
      isModelAvailable: vi.fn(async () => true),
      downloadModel: vi.fn(),
    } as never);
    vi.mocked(hasLocalFontOcr).mockRejectedValue(new Error('OCR manifest unavailable'));

    render(<FontDetectSection nodes={[image]} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Identify font in image' })).toBeVisible(),
    );
    expect(screen.queryByRole('button', { name: /Download AI Model/ })).not.toBeInTheDocument();
    expect(screen.getByText('Local OCR models are unavailable in this runtime.')).toBeVisible();
  });
});
