// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { addChild, createDocument, makeTextNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../context';
import { DocumentFontsPanel } from './DocumentFontsPanel';

vi.mock('../../context', () => ({ useEditor: vi.fn() }));

const mockedUseEditor = vi.mocked(useEditor);

function makeEditorState() {
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
  return {
    state: { document, selection: [], workspaceMode: 'design' },
    setSelectionRefs: vi.fn(),
    announce: vi.fn(),
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

  it('switches to the full browser without changing the document', () => {
    render(<DocumentFontsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse all fonts' }));
    expect(screen.getByText('Browse all fonts')).toBeVisible();
    expect(
      screen.getByRole('searchbox', { name: 'Search fonts by name or design language' }),
    ).toBeVisible();
  });
});
