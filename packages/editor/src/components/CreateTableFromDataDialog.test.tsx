// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  createDesignCanvas,
  createDocument,
  type Document,
  designCanvasChildren,
} from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { patch, updateDoc, setSelection, announce, committed } = vi.hoisted(() => ({
  patch: vi.fn(),
  updateDoc: vi.fn(),
  setSelection: vi.fn(),
  announce: vi.fn(),
  committed: { doc: null as Document | null },
}));

function documentFixture(): Document {
  return createDesignCanvas(createDocument());
}

// Only the editor hook is mocked; the dialog's insertion goes through the
// real addNodeToActiveWorkspace, so the active-surface contract is exercised.
vi.mock('../context', () => ({
  useEditor: () => ({
    state: { document: documentFixture(), workspaceMode: 'design' },
    patch,
    updateDoc: (fn: (doc: Document) => Document) => {
      const next = fn(documentFixture());
      committed.doc = next;
      updateDoc();
      return next;
    },
    setSelection,
    announce,
  }),
}));

import { CreateTableFromDataDialog } from './CreateTableFromDataDialog';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  committed.doc = null;
});

describe('CreateTableFromDataDialog', () => {
  it('mounts its paste workflow only while open', () => {
    render(<CreateTableFromDataDialog open={false} />);
    expect(screen.queryByLabelText(/paste csv/i)).toBeNull();
  });

  it('previews pasted CSV and commits a table into the active surface', () => {
    render(<CreateTableFromDataDialog open />);
    const textarea = screen.getByLabelText(/paste csv/i);
    expect(textarea).toHaveFocus();

    fireEvent.change(textarea, { target: { value: 'name,qty\nWidget,4\nGadget,7' } });

    expect(screen.getByText('3 rows x 2 columns')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Preview' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /create table/i }));
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(setSelection).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith({ createTableFromDataOpen: false });

    // Regression: the table used to be appended to the raw document root,
    // which left it out of the Layers panel and its surface. It must be a
    // child of the active design canvas's content root.
    expect(committed.doc).not.toBeNull();
    const surfaceChildren = designCanvasChildren(committed.doc as Document);
    expect(surfaceChildren).toHaveLength(1);
    const tableNode = (committed.doc as Document).nodes[surfaceChildren[0]!];
    expect(tableNode?.kind).toBe('table');
  });

  it('keeps the create action disabled until data parses', () => {
    render(<CreateTableFromDataDialog open />);
    expect(screen.getByRole('button', { name: /create table/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/paste csv/i), {
      target: { value: 'a,b\n1,2' },
    });
    expect(screen.getByRole('button', { name: /create table/i })).toBeEnabled();
  });

  it('closes on Escape through the shared dialog', () => {
    render(<CreateTableFromDataDialog open />);
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(patch).toHaveBeenCalledWith({ createTableFromDataOpen: false });
  });

  it('closes on a backdrop press and release', () => {
    render(<CreateTableFromDataDialog open />);
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent.pointerDown(dialog);
    fireEvent.pointerUp(dialog);
    fireEvent.click(dialog);
    expect(patch).toHaveBeenCalledWith({ createTableFromDataOpen: false });
  });
});
