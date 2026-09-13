// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { addChild, createDocument, makeTextNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../context';
import { DocumentFontsPanel } from './DocumentFontsPanel';

vi.mock('../../context', () => ({ useEditor: vi.fn() }));
vi.mock('./FontBrowserDialog', () => ({
  FontBrowserDialog: ({
    onClose,
    onSelect,
    onSelectFace,
  }: {
    onClose: () => void;
    onSelect?: (family: string) => void;
    onSelectFace?: (selection: {
      family: string;
      weight: number;
      style: 'normal' | 'italic';
      fontReference?: { artifactHash: string; collectionIndex?: number; postScriptName?: string };
    }) => void;
  }) => (
    <div role="dialog" aria-label="Browse fonts">
      <button type="button" onClick={() => onSelect?.('Noto Sans')}>
        Use family
      </button>
      <button
        type="button"
        onClick={() =>
          onSelectFace?.({
            family: 'Noto Sans',
            weight: 700,
            style: 'normal',
            fontReference: { artifactHash: 'c'.repeat(64), postScriptName: 'NotoSans-Bold' },
          })
        }
      >
        Use exact face
      </button>
      <button type="button" onClick={onClose}>
        Cancel replacement
      </button>
    </div>
  ),
}));

const mockedUseEditor = vi.mocked(useEditor);

function makeEditorState(options: { withReplacement?: boolean } = {}) {
  let document = createDocument('document-fonts-panel');
  const rootId = document.pages?.[0]?.contentRoot;
  if (!rootId) throw new Error('fixture page root missing');
  const exact = makeTextNode('exact', 'Exact', { fontFamily: 'Inter', fontWeight: 700 });
  exact.fontReference = {
    artifactHash: 'b'.repeat(64),
    postScriptName: 'Inter-Bold',
  };
  const familyOnly = makeTextNode('family-only', 'Family', { fontFamily: 'Inter' });
  document = addChild(document, rootId, exact);
  document = addChild(document, rootId, familyOnly);
  if (options.withReplacement) {
    document = {
      ...document,
      fontManifest: {
        version: 2,
        fonts: [],
        replacements: [
          {
            original: 'Arial',
            replacement: 'Inter',
            replacementReference: exact.fontReference,
            applyToAll: true,
            preserveOriginalReference: true,
          },
        ],
      },
    };
  }
  return {
    state: { document, selection: [], workspaceMode: 'design' },
    setSelectionRefs: vi.fn(),
    announce: vi.fn(),
    revealSelection: vi.fn(),
    setActivePage: vi.fn(),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    updateDoc: vi.fn((fn: (value: typeof document) => typeof document) => fn(document)),
  } as unknown as ReturnType<typeof useEditor>;
}

beforeEach(() => {
  mockedUseEditor.mockReturnValue(makeEditorState());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DocumentFontsPanel', () => {
  it('shows exact faces separately and lets the user scope the usage list', () => {
    render(<DocumentFontsPanel />);

    expect(screen.getByRole('heading', { name: 'Document fonts' })).toBeVisible();
    expect(screen.getAllByText('Inter')).toHaveLength(2);
    expect(screen.getByText('Exact face · single face')).toBeVisible();
    expect(screen.getByText('Family only')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Entire document' })).toBeVisible();
  });

  it('selects all matching text layers in one selection update', () => {
    const editor = makeEditorState();
    mockedUseEditor.mockReturnValue(editor);
    render(<DocumentFontsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Select text using Inter 400 normal' }));

    expect(editor.setSelectionRefs).toHaveBeenCalledWith(['family-only'], {
      primary: 'family-only',
      origin: 'api',
    });
    expect(editor.announce).toHaveBeenCalledWith('Selected 1 text layer using Inter');
  });

  it('navigates to the first matching layer when the document scope spans surfaces', () => {
    const editor = makeEditorState();
    mockedUseEditor.mockReturnValue(editor);
    render(<DocumentFontsPanel />);

    fireEvent.click(screen.getAllByRole('button', { name: /^Go to / })[0]!);

    expect(editor.setSelectionRefs).toHaveBeenCalledWith(
      [expect.any(String)],
      expect.objectContaining({ origin: 'api' }),
    );
    expect(editor.revealSelection).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'center', nodeId: expect.any(String) }),
    );
  });

  it('switches to the full browser without changing the document', () => {
    render(<DocumentFontsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse all fonts' }));
    expect(screen.getByText('Browse all fonts')).toBeVisible();
    expect(
      screen.getByRole('searchbox', { name: 'Search fonts by name or design language' }),
    ).toBeVisible();
  });

  it('opens a scoped replacement chooser and applies an exact face in one transaction', () => {
    const editor = makeEditorState();
    mockedUseEditor.mockReturnValue(editor);
    render(<DocumentFontsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Replace Inter Inter-Bold' }));
    expect(screen.getByRole('dialog', { name: 'Browse fonts' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Use exact face' }));
    expect(editor.beginTransaction).toHaveBeenCalledTimes(1);
    expect(editor.commitTransaction).toHaveBeenCalledTimes(1);
    expect(editor.updateDoc).toHaveBeenCalledTimes(1);
    expect(editor.announce).toHaveBeenCalledWith(
      'Replaced Inter in 1 text layer. Layout may change.',
    );
  });

  it('previews an exact restore before committing and supports cancellation', () => {
    const editor = makeEditorState({ withReplacement: true });
    mockedUseEditor.mockReturnValue(editor);
    render(<DocumentFontsPanel />);

    const restoreButton = screen.getByRole('button', {
      name: 'Restore original Inter Inter-Bold',
    });
    fireEvent.click(restoreButton);
    expect(screen.getByRole('heading', { name: 'Restore original font?' })).toBeVisible();
    expect(screen.getByText(/Preview: Inter to Arial/)).toBeVisible();
    expect(editor.beginTransaction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Restore original font?' })).toBeNull();
    expect(editor.beginTransaction).not.toHaveBeenCalled();

    fireEvent.click(restoreButton);
    fireEvent.click(screen.getByRole('button', { name: 'Restore original' }));
    expect(editor.beginTransaction).toHaveBeenCalledTimes(1);
    expect(editor.commitTransaction).toHaveBeenCalledTimes(1);
    expect(editor.updateDoc).toHaveBeenCalledTimes(1);
    expect(editor.announce).toHaveBeenCalledWith(
      'Restored Arial in 1 text layer. Layout may change.',
    );
  });
});
