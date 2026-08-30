// @ts-nocheck
/**
 * PagesPanel (M7) — renders page rows (thumbnail, name, number, side,
 * master, section), navigates, and drives add/duplicate/delete/reorder
 * through updateDoc.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@varve/scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/scene')>();
  return {
    ...actual,
    addPage: vi.fn((doc: unknown) => doc),
    deletePageWithPolicy: vi.fn((doc: unknown) => doc),
    duplicatePage: vi.fn((doc: unknown) => doc),
    removePage: vi.fn((doc: unknown) => doc),
    reorderPages: vi.fn((doc: unknown) => doc),
  };
});

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

vi.mock('../../pageCommands', () => ({
  createPageCommand: vi.fn((doc: unknown) => doc),
  deletePageCommand: vi.fn((doc: unknown) => doc),
  duplicatePageCommand: vi.fn((doc: unknown) => doc),
  reorderPagesCommand: vi.fn((doc: unknown) => doc),
}));

vi.mock('../PageNav/usePageThumbnail', () => ({
  usePageThumbnail: vi.fn(() => null),
}));

vi.mock('../../workspace/useWorkspaceConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../workspace/useWorkspaceConfig')>();
  return {
    ...actual,
    useEffectiveWorkspaceConfig: vi.fn(() => ({ panels: { pagenav: { visible: true } } })),
  };
});

import { useEditor } from '../../context';
import { useEffectiveWorkspaceConfig } from '../../workspace/useWorkspaceConfig';
import { PagesPanel } from './PagesPanel';

interface MockPage {
  id: string;
  name: string;
  width: number;
  height: number;
  backgrounds: string[];
  contentRoot: string;
  order: string;
  masterPageId?: string | null;
}

function makePage(id: string, name: string, order: string): MockPage {
  return { id, name, width: 1920, height: 1080, backgrounds: [], contentRoot: `${id}-root`, order };
}

function mockEditor(overrides: {
  pages: MockPage[];
  activePageId?: string | null;
  workspaceMode?: string;
  masters?: Record<string, { name: string }>;
  sections?: Array<{ id: string; name: string; startPageOrder: string }>;
  updateDoc?: ReturnType<typeof vi.fn>;
  setActivePage?: ReturnType<typeof vi.fn>;
  setCurrentPageId?: ReturnType<typeof vi.fn>;
  setSelection?: ReturnType<typeof vi.fn>;
  announce?: ReturnType<typeof vi.fn>;
  designCanvases?: Array<{ id: string; name: string; order: string; contentRoot: string }>;
  activeDesignCanvasId?: string | null;
}) {
  const activePageId = overrides.activePageId ?? overrides.pages[0]?.id ?? null;
  vi.mocked(useEditor).mockReturnValue({
    state: {
      workspaceMode: overrides.workspaceMode ?? 'print',
      document: {
        pages: overrides.pages,
        activePageId,
        masters: overrides.masters ?? {},
        sections: overrides.sections ?? [],
        nodes: {},
        rootChildren: [],
        globalChildren: [],
        designCanvases: overrides.designCanvases,
        activeDesignCanvasId: overrides.activeDesignCanvasId,
      },
      currentPageId: activePageId,
    },
    updateDoc: overrides.updateDoc ?? vi.fn(),
    setActivePage: overrides.setActivePage ?? vi.fn(),
    setCurrentPageId: overrides.setCurrentPageId ?? vi.fn(),
    setSelection: overrides.setSelection ?? vi.fn(),
    announce: overrides.announce ?? vi.fn(),
    getPageSide: (pageId: string) => {
      const idx = overrides.pages.findIndex((p) => p.id === pageId);
      return idx % 2 === 0 ? 'left' : 'right';
    },
  } as unknown as ReturnType<typeof useEditor>);
}

describe('PagesPanel', () => {
  it('renders page rows with display numbers and side badges', () => {
    mockEditor({ pages: [makePage('p1', 'Page 1', 'a0'), makePage('p2', 'Page 2', 'a1')] });
    render(<PagesPanel />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Page 1');
    expect(rows[0]!.textContent).toContain('1');
    expect(rows[1]!.textContent).toContain('2');
    expect(rows[0]!.textContent).toContain('left');
  });

  it('marks the active page with aria-current', () => {
    mockEditor({
      pages: [makePage('p1', 'Page 1', 'a0'), makePage('p2', 'Page 2', 'a1')],
      activePageId: 'p2',
    });
    render(<PagesPanel />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[1]!.getAttribute('aria-current')).toBe('page');
    expect(rows[0]!.getAttribute('aria-current')).toBeNull();
  });

  it('shows master and section badges', () => {
    const page = { ...makePage('p1', 'Page 1', 'a0'), masterPageId: 'm1' };
    mockEditor({
      pages: [page],
      masters: { m1: { name: 'Body Left' } },
      sections: [{ id: 's1', name: 'Front Matter', startPageOrder: 'a0' }],
      activePageId: 'p1',
    });
    render(<PagesPanel />);
    const row = screen.getByRole('listitem');
    expect(row.textContent).toContain('Body Left');
    expect(row.textContent).toContain('Front Matter');
  });

  it('adds a page through updateDoc', () => {
    const updateDoc = vi.fn((fn: (doc: unknown) => unknown) =>
      fn({ pages: [makePage('p1', 'Page 1', 'a0')] }),
    );
    mockEditor({ pages: [makePage('p1', 'Page 1', 'a0')], updateDoc });
    render(<PagesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add publishing page' }));
    expect(updateDoc).toHaveBeenCalled();
  });

  it('duplicates a page through updateDoc', () => {
    const updateDoc = vi.fn((fn: (doc: unknown) => unknown) =>
      fn({ pages: [makePage('p1', 'Page 1', 'a0')] }),
    );
    mockEditor({ pages: [makePage('p1', 'Page 1', 'a0')], updateDoc });
    render(<PagesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Page 1' }));
    expect(updateDoc).toHaveBeenCalled();
  });

  it('deletes a page through updateDoc', () => {
    const updateDoc = vi.fn((fn: (doc: unknown) => unknown) =>
      fn({ pages: [makePage('p1', 'Page 1', 'a0')] }),
    );
    mockEditor({ pages: [makePage('p1', 'Page 1', 'a0')], updateDoc });
    render(<PagesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Page 1' }));
    expect(updateDoc).toHaveBeenCalled();
  });

  it('navigates on row click and Enter', () => {
    const setActivePage = vi.fn();
    const setCurrentPageId = vi.fn();
    mockEditor({
      pages: [makePage('p1', 'Page 1', 'a0'), makePage('p2', 'Page 2', 'a1')],
      setActivePage,
      setCurrentPageId,
    });
    render(<PagesPanel />);
    fireEvent.click(screen.getByRole('listitem', { name: /Publishing page 2/ }));
    expect(setActivePage).toHaveBeenCalledWith('p2');
    expect(setCurrentPageId).toHaveBeenCalledWith('p2');
  });

  it('moves a page earlier through updateDoc', () => {
    const updateDoc = vi.fn((fn: (doc: unknown) => unknown) =>
      fn({ pages: [makePage('p1', 'Page 1', 'a0'), makePage('p2', 'Page 2', 'a1')] }),
    );
    mockEditor({
      pages: [makePage('p1', 'Page 1', 'a0'), makePage('p2', 'Page 2', 'a1')],
      updateDoc,
    });
    render(<PagesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Page 2 earlier' }));
    expect(updateDoc).toHaveBeenCalled();
  });

  it('renders nothing when the active workspace hides page navigation', () => {
    mockEditor({ pages: [makePage('p1', 'Page 1', 'a0')], workspaceMode: 'drawing' });
    const { container } = render(<PagesPanel />);
    expect(container.innerHTML).toBe('');
  });

  it('keeps the empty page-management affordance available in Print', () => {
    mockEditor({ pages: [], workspaceMode: 'print' });
    render(<PagesPanel />);
    expect(screen.getByRole('heading', { name: /Publishing pages/ })).toBeTruthy();
    expect(screen.getByText('No publishing pages — click + to add one.')).toBeTruthy();
    expect(screen.getByText(/Publishing pages define trim/)).toBeTruthy();
  });

  it('discloses the Design Canvas panel even when the collection is empty', () => {
    mockEditor({ pages: [], workspaceMode: 'design' });
    render(<PagesPanel />);
    expect(screen.getByRole('heading', { name: /Design Canvases/ })).toBeTruthy();
    expect(screen.getByText('No Design Canvases — click + to create one.')).toBeTruthy();
  });

  it('respects the Design Canvas panel visibility preference', () => {
    mockEditor({ pages: [], workspaceMode: 'design' });
    const workspaceConfig = vi.mocked(useEffectiveWorkspaceConfig);
    workspaceConfig.mockReturnValue({ panels: { pagenav: { visible: false } } });
    const { container } = render(<PagesPanel />);
    expect(container.innerHTML).toBe('');
    workspaceConfig.mockReturnValue({ panels: { pagenav: { visible: true } } });
  });
});

describe('Design Canvas presentation', () => {
  it('shows canvases as a separate surface list, not as publishing pages', () => {
    mockEditor({
      pages: [],
      workspaceMode: 'design',
      designCanvases: [{ id: 'c1', name: 'Campaign', order: 'a0', contentRoot: 'root-c1' }],
      activeDesignCanvasId: 'c1',
    });

    render(<PagesPanel />);

    expect(screen.getByRole('region', { name: 'Design Canvases' })).toBeInTheDocument();
    expect(screen.getByText('Campaign')).toBeInTheDocument();
    expect(screen.queryByText('Publishing pages')).not.toBeInTheDocument();
  });

  it('exposes create and rename actions for Design Canvases', () => {
    const updateDoc = vi.fn();
    const setSelection = vi.fn();
    mockEditor({
      pages: [],
      workspaceMode: 'design',
      designCanvases: [{ id: 'c1', name: 'Campaign', order: 'a0', contentRoot: 'root-c1' }],
      activeDesignCanvasId: 'c1',
      updateDoc,
      setSelection,
    });

    render(<PagesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Design Canvas' }));

    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(setSelection).toHaveBeenCalledWith(null);
    expect(screen.getByRole('button', { name: 'Rename Campaign' })).toBeInTheDocument();
  });
});
