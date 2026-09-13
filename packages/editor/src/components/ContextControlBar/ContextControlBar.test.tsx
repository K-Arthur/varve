import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { makeTextNode } from '@varve/scene';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../context';
import { ContextControlBar } from './ContextControlBar';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

vi.mock('../FontBrowser/FontSelector', () => ({
  FontSelector: ({ value, onChange }: { value: string; onChange: (family: string) => void }) => (
    <input
      aria-label="Font family"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock('@varve/ui', () => ({
  Icon: () => <span aria-hidden="true" />,
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
}));

const node = makeTextNode('text-1', 'Typography', {
  fontFamily: 'Arial',
  fontSize: 16,
  fontWeight: 400,
});

const updateNode = vi.fn();
const applyFormatToSelection = vi.fn();
const setPendingFormat = vi.fn();
const groupCompoundOperation = vi.fn((_label: string, action: () => void) => action());

beforeEach(() => {
  updateNode.mockReset();
  applyFormatToSelection.mockReset();
  setPendingFormat.mockReset();
  groupCompoundOperation.mockClear();
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
