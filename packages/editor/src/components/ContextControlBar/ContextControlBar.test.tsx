import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { defaultStroke, makeShapeNode, makeTextNode } from '@varve/scene';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../context';
import { publishTextEditSession } from '../../context/textEditSession';
import { ContextControlBar } from './ContextControlBar';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

vi.mock('../FontBrowser/FontSelector', () => ({
  FontSelector: ({
    value,
    onChange,
    onPreviewFamily,
    onClearPreview,
  }: {
    value: string;
    onChange: (family: string) => void;
    onPreviewFamily?: (family: string) => void;
    onClearPreview?: () => void;
  }) => (
    <>
      <input
        aria-label="Font family"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        aria-label="Preview family"
        onMouseEnter={() => onPreviewFamily?.('Preview Font')}
      />
      <button type="button" aria-label="Apply family" onClick={() => onChange('Applied Font')} />
      <button type="button" aria-label="Clear font preview" onClick={onClearPreview} />
    </>
  ),
}));

vi.mock('@varve/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/ui')>();
  return {
    ...actual,
    Icon: () => <span aria-hidden="true" />,
    FloatingPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
    FocusTrap: ({ children }: { children: ReactNode }) => <>{children}</>,
    Toolbar: ({
      label,
      children,
      className,
    }: {
      label: string;
      children: ReactNode;
      className?: string;
    }) => (
      <div className={className} role="toolbar" aria-label={label}>
        {children}
      </div>
    ),
    Select: ({
      label,
      value,
      options,
      onChange,
    }: {
      label: string;
      value: string;
      options: Array<{ value: string; label: string }>;
      onChange?: (value: string) => void;
    }) => (
      <select aria-label={label} value={value} onChange={(event) => onChange?.(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

const node = makeTextNode('text-1', 'Typography', {
  fontFamily: 'Arial',
  fontSize: 16,
  fontWeight: 400,
});

const updateNode = vi.fn();
const applyFormatToSelection = vi.fn();
const setPendingFormat = vi.fn();
const groupCompoundOperation = vi.fn((_label: string, action: () => void) => action());
const beginTransaction = vi.fn();
const commitTransaction = vi.fn();
const abortTransaction = vi.fn();

beforeEach(() => {
  updateNode.mockReset();
  applyFormatToSelection.mockReset();
  setPendingFormat.mockReset();
  groupCompoundOperation.mockClear();
  beginTransaction.mockReset();
  commitTransaction.mockReset();
  abortTransaction.mockReset();
  vi.mocked(useEditor).mockReturnValue({
    state: {
      selection: [node.id],
      document: { nodes: { [node.id]: node } },
      selectionRange: null,
      pendingFormat: null,
    },
    updateNode,
    applyFormatToSelection,
    setPendingFormat,
    groupCompoundOperation,
    beginTransaction,
    commitTransaction,
    abortTransaction,
    setTool: vi.fn(),
    groupSelected: vi.fn(),
    setSelectedFlipH: vi.fn(),
    setSelectedFlipV: vi.fn(),
    applyFramePreset: vi.fn(),
    setNodeClipContent: vi.fn(),
    removeBackground: vi.fn(),
    openVectorizeDialog: vi.fn(),
    alignSelected: vi.fn(),
    booleanOp: vi.fn(),
  } as never);
});

afterEach(() => {
  vi.clearAllMocks();
  publishTextEditSession(null);
});

describe('ContextControlBar typography controls', () => {
  it('exposes an editable family field and clears an old exact reference', () => {
    render(<ContextControlBar />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Font family' }), {
      target: { value: 'IBM Plex Sans Variable' },
    });

    const [, updater] = updateNode.mock.calls[0] as [string, (current: typeof node) => typeof node];
    expect(updateNode).toHaveBeenCalledWith(node.id, expect.any(Function));
    expect(
      updater({ ...node, fontReference: { artifactHash: 'a'.repeat(64), collectionIndex: 0 } }),
    ).toEqual(
      expect.objectContaining({
        fontFamily: 'IBM Plex Sans Variable',
        fontReference: undefined,
      }),
    );
  });

  it('routes weight edits through the shared variable-axis adapter', () => {
    render(<ContextControlBar />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Font weight' }), {
      target: { value: '700' },
    });

    const [, updater] = updateNode.mock.calls[0] as [string, (current: typeof node) => typeof node];
    expect(updater(node)).toEqual(expect.objectContaining({ fontWeight: 700 }));
  });

  it('blocks synthetic italic when the selected face has no real italic capability', () => {
    render(<ContextControlBar />);
    const italic = screen.getByRole('button', { name: 'Italic' });

    expect(italic).toBeDisabled();
    expect(italic).toHaveAttribute('title', 'This font has no real italic face');
  });

  it('keeps bold parity with the floating text toolbar', () => {
    render(<ContextControlBar />);
    const bold = screen.getByRole('button', { name: 'Bold' });

    expect(bold).not.toBeDisabled();
    expect(bold).toHaveAttribute('aria-pressed', 'false');
  });

  it('stops duplicating typography controls while the canvas edit session is active', () => {
    // Regression: with a text edit session running, the context bar rendered
    // the same font/weight/bold/italic/size controls as the floating text bar
    // at the same time. The canvas bar (beside the work) owns formatting; the
    // context row states where the controls are instead of duplicating them.
    publishTextEditSession(node.id);
    try {
      render(<ContextControlBar />);
      expect(screen.queryByRole('button', { name: 'Bold' })).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'Font family' })).not.toBeInTheDocument();
      expect(screen.getByText(/editing on canvas/i)).toBeInTheDocument();
    } finally {
      publishTextEditSession(null);
    }
  });

  it('applies a real bold face from the contextual toolbar', () => {
    const boldNode = makeTextNode('text-1', 'Typography', {
      fontFamily: 'Arial',
      fontSize: 16,
      fontWeight: 400,
    });
    vi.mocked(useEditor).mockReturnValue({
      state: {
        selection: [boldNode.id],
        document: { nodes: { [boldNode.id]: boldNode } },
        selectionRange: null,
        pendingFormat: null,
      },
      updateNode,
      applyFormatToSelection,
      setPendingFormat,
      groupCompoundOperation,
      setTool: vi.fn(),
      groupSelected: vi.fn(),
      setSelectedFlipH: vi.fn(),
      setSelectedFlipV: vi.fn(),
      applyFramePreset: vi.fn(),
      setNodeClipContent: vi.fn(),
      removeBackground: vi.fn(),
      openVectorizeDialog: vi.fn(),
      alignSelected: vi.fn(),
      booleanOp: vi.fn(),
    } as never);

    render(<ContextControlBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));

    const [, updater] = updateNode.mock.calls[0] as [
      string,
      (current: typeof boldNode) => typeof boldNode,
    ];
    expect(updater(boldNode)).toEqual(expect.objectContaining({ fontWeight: 700 }));
  });

  it('applies a family edit to the active rich-text range', () => {
    vi.mocked(useEditor).mockReturnValue({
      state: {
        selection: [node.id],
        document: { nodes: { [node.id]: node } },
        selectionRange: {
          start: { paragraphIndex: 0, offset: 0 },
          end: { paragraphIndex: 0, offset: 4 },
        },
        pendingFormat: null,
      },
      updateNode,
      applyFormatToSelection,
      setPendingFormat,
      groupCompoundOperation,
      beginTransaction,
      commitTransaction,
      abortTransaction,
      setTool: vi.fn(),
      groupSelected: vi.fn(),
      setSelectedFlipH: vi.fn(),
      setSelectedFlipV: vi.fn(),
      applyFramePreset: vi.fn(),
      setNodeClipContent: vi.fn(),
      removeBackground: vi.fn(),
      openVectorizeDialog: vi.fn(),
      alignSelected: vi.fn(),
      booleanOp: vi.fn(),
    } as never);

    render(<ContextControlBar />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Font family' }), {
      target: { value: 'IBM Plex Sans Variable' },
    });

    expect(applyFormatToSelection).toHaveBeenCalledWith(
      expect.objectContaining({ fontFamily: 'IBM Plex Sans Variable', fontReference: undefined }),
    );
    expect(updateNode).not.toHaveBeenCalled();
  });

  it('keeps quick-picker preview outside history until selection is confirmed', () => {
    render(<ContextControlBar />);

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Preview family' }));
    expect(beginTransaction).toHaveBeenCalledWith('preview');
    expect(updateNode).toHaveBeenCalledOnce();
    expect(commitTransaction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Apply family' }));
    expect(commitTransaction).toHaveBeenCalledOnce();

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Preview family' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear font preview' }));
    expect(abortTransaction).toHaveBeenCalledOnce();
  });

  it('commits a valid size once on blur and rejects invalid values', () => {
    render(<ContextControlBar />);
    const input = screen.getByRole('spinbutton', { name: 'Font size' });
    fireEvent.change(input, { target: { value: '24' } });
    fireEvent.blur(input);
    expect(updateNode).toHaveBeenCalledOnce();
    const [, updater] = updateNode.mock.calls[0] as [string, (current: typeof node) => typeof node];
    expect(updater(node)).toEqual(expect.objectContaining({ fontSize: 24 }));

    updateNode.mockReset();
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(updateNode).not.toHaveBeenCalled();
  });
});

describe('ContextControlBar shape controls', () => {
  const shape = makeShapeNode(
    'shape-1',
    { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    { name: 'Rect' },
  );

  function mockShapeEditor(selected: typeof shape = shape) {
    vi.mocked(useEditor).mockReturnValue({
      state: {
        selection: [selected.id],
        document: { nodes: { [selected.id]: selected } },
        selectionRange: null,
        pendingFormat: null,
      },
      updateNode,
      beginTransaction,
      commitTransaction,
      abortTransaction,
      announce: vi.fn(),
      setSelectedFill: vi.fn(),
      documentColorMode: 'rgb',
      setTool: vi.fn(),
      groupSelected: vi.fn(),
      setSelectedFlipH: vi.fn(),
      setSelectedFlipV: vi.fn(),
      applyFramePreset: vi.fn(),
      setNodeClipContent: vi.fn(),
      removeBackground: vi.fn(),
      openVectorizeDialog: vi.fn(),
      alignSelected: vi.fn(),
      booleanOp: vi.fn(),
    } as never);
  }

  it('offers fill and an add-stroke action for a shape with no stroke', () => {
    mockShapeEditor();
    render(<ContextControlBar />);

    expect(screen.getByRole('button', { name: 'Fill colour' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add stroke' })).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Stroke width' })).not.toBeInTheDocument();
  });

  it('adds a default stroke in one transaction', () => {
    mockShapeEditor();
    render(<ContextControlBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Add stroke' }));

    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(commitTransaction).toHaveBeenCalledOnce();
    const [, updater] = updateNode.mock.calls[0] as [string, (n: typeof shape) => typeof shape];
    const next = updater(shape);
    expect(next.strokes).toHaveLength(1);
    expect(next.strokes?.[0]?.weight).toBeGreaterThan(0);
  });

  it('shows the stroke colour and weight when a stroke exists and commits a weight edit', () => {
    const stroked = makeShapeNode(
      'shape-2',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Rect', strokes: [{ ...defaultStroke(), id: 'stroke-1' }] },
    );
    mockShapeEditor(stroked);

    render(<ContextControlBar />);
    expect(screen.getByRole('button', { name: 'Stroke colour' })).toBeInTheDocument();
    const weight = screen.getByRole('spinbutton', { name: 'Stroke width' });
    fireEvent.change(weight, { target: { value: '4' } });
    fireEvent.blur(weight);

    const [, updater] = updateNode.mock.calls[0] as [string, (n: typeof stroked) => typeof stroked];
    expect(updater(stroked).strokes?.[0]?.weight).toBe(4);
  });

  it('keeps flip H and flip V reachable beside the colour controls', () => {
    mockShapeEditor();
    render(<ContextControlBar />);
    expect(screen.getByRole('button', { name: 'Flip horizontal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Flip vertical' })).toBeInTheDocument();
  });
});
