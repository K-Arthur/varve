import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { makeTextNode } from '@varve/scene';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../context';
import { LogoTypographySection } from './LogoTypographySection';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

vi.mock('../FontBrowser/FontSelector', () => ({
  FontSelector: ({
    value,
    label,
    onChange,
  }: {
    value: string;
    label: string;
    onChange: (family: string) => void;
  }) => (
    <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

vi.mock('../FontBrowser/FontBrowserDialog', () => ({
  FontBrowserDialog: ({
    onSelectFace,
  }: {
    onSelectFace: (selection: {
      family: string;
      weight: number;
      style: 'normal' | 'italic';
      fontReference?: { artifactHash: string; collectionIndex?: number };
    }) => void;
  }) => (
    <button
      type="button"
      aria-label="Choose exact face"
      onClick={() =>
        onSelectFace({
          family: 'Geist Variable',
          weight: 650,
          style: 'italic',
          fontReference: { artifactHash: 'a'.repeat(64), collectionIndex: 0 },
        })
      }
    />
  ),
}));

vi.mock('../Typography/GlyphTypographySection', () => ({
  GlyphTypographySection: () => <div aria-hidden="true" />,
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
  Icon: () => <span aria-hidden="true" />,
  NumberInput: ({ label, value }: { label: string; value: number }) => (
    <input aria-label={label} value={value} readOnly />
  ),
  Select: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: Array<{ value: string; label: string; disabled?: boolean; disabledReason?: string }>;
    onChange: (value: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          title={option.disabled ? option.disabledReason : undefined}
        >
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const node = makeTextNode('logo-text', 'Varve', {
  // The registry knows both Arial 400 and 700, keeping this interaction test
  // focused on selecting an available face.
  fontFamily: 'Arial',
  fontWeight: 400,
  fontStyle: 'normal',
  fontSize: 48,
});

const updateDoc = vi.fn();
const groupCompoundOperation = vi.fn((_label: string, action: () => void) => action());

beforeEach(() => {
  updateDoc.mockReset();
  groupCompoundOperation.mockClear();
  vi.mocked(useEditor).mockReturnValue({
    updateDoc,
    groupCompoundOperation,
    convertTextToOutlines: vi.fn(),
  } as never);
});

function applyLastDocumentUpdate() {
  const [updater] = updateDoc.mock.calls.at(-1) as [
    (doc: { nodes: Record<string, typeof node> }) => { nodes: Record<string, typeof node> },
  ];
  return updater({ nodes: { [node.id]: node } });
}

describe('LogoTypographySection', () => {
  it('uses the shared family picker and clears stale exact-face identity', () => {
    render(<LogoTypographySection node={node} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Font family' }), {
      target: { value: 'IBM Plex Sans Variable' },
    });

    expect(applyLastDocumentUpdate().nodes[node.id]).toEqual(
      expect.objectContaining({
        fontFamily: 'IBM Plex Sans Variable',
        fontReference: undefined,
      }),
    );
    expect(groupCompoundOperation).toHaveBeenCalledWith('Typography', expect.any(Function));
  });

  it('applies an exact face, style, and weight from the font browser', () => {
    render(<LogoTypographySection node={node} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose exact face' }));

    expect(applyLastDocumentUpdate().nodes[node.id]).toEqual(
      expect.objectContaining({
        fontFamily: 'Geist Variable',
        fontWeight: 650,
        fontStyle: 'italic',
        fontReference: { artifactHash: 'a'.repeat(64), collectionIndex: 0 },
      }),
    );
  });

  it('exposes weight and style controls on the wordmark surface', () => {
    render(<LogoTypographySection node={node} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Font weight' }), {
      target: { value: '700' },
    });
    expect(applyLastDocumentUpdate().nodes[node.id]).toEqual(
      expect.objectContaining({ fontWeight: 700 }),
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Font style' }), {
      target: { value: 'italic' },
    });
    expect(applyLastDocumentUpdate().nodes[node.id]).toEqual(
      expect.objectContaining({ fontStyle: 'italic' }),
    );
  });

  it('clears a stale exact face when the requested style is unavailable', () => {
    const exactNode = {
      ...node,
      fontReference: { artifactHash: 'f'.repeat(64) },
    };
    render(<LogoTypographySection node={exactNode} />);

    expect(screen.getByRole('option', { name: 'Italic' })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: 'Font style' }), {
      target: { value: 'italic' },
    });

    expect(applyLastDocumentUpdate().nodes[exactNode.id]).toEqual(
      expect.objectContaining({ fontStyle: 'italic', fontReference: undefined }),
    );
  });
});
