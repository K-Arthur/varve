// @ts-nocheck
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

type Page = {
  id: string;
  name: string;
  width: number;
  height: number;
  backgrounds: string[];
  contentRoot: string;
};

vi.mock('@varve/scene', () => ({
  addPage: vi.fn((doc: unknown) => doc),
  duplicatePage: vi.fn((doc: unknown) => doc),
  removePage: vi.fn((doc: unknown) => doc),
  reorderPages: vi.fn((doc: unknown) => doc),
}));

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

// Mock thumbnail generation so PageNav tests don't try to create
// OffscreenCanvas or call canvas encoding APIs — these tests verify
// page navigation behaviour, not thumbnail content.
vi.mock('../../thumbnail', () => ({
  generateDocThumbnail: vi.fn(async () => ({
    dataUrl: 'data:image/png;base64,mock',
    metadata: {
      cacheKey: 'mock',
      sourceBounds: { x: 0, y: 0, w: 100, h: 100 },
      scaleFactor: 1,
      outputWidth: 180,
      outputHeight: 90,
      mimeType: 'image/png',
      generatedAt: Date.now(),
      revisionId: 'mock',
      isPlaceholder: false,
      warnings: [],
    },
  })),
  generateDocThumbnailOptions: {} as never,
  ThumbnailSourceType: {} as never,
  sourceLabel: vi.fn((_s: unknown) => 'Mock'),
}));

import { useEditor } from '../../context';
import { computeReorderedPageIds, PageNav } from './PageNav';

function makePage(id: string, name: string): Page {
  return { id, name, width: 1920, height: 1080, backgrounds: [], contentRoot: `${id}-root` };
}

function mockEditor(overrides: {
  pages: Page[];
  activePageId?: string | null;
  currentPageId?: string | null;
  updateDoc?: ReturnType<typeof vi.fn>;
  setActivePage?: ReturnType<typeof vi.fn>;
  setCurrentPageId?: ReturnType<typeof vi.fn>;
}) {
  const activePageId =
    overrides.activePageId ?? overrides.currentPageId ?? overrides.pages[0]?.id ?? null;
  vi.mocked(useEditor).mockReturnValue({
    state: {
      document: { pages: overrides.pages, activePageId },
      currentPageId: overrides.currentPageId ?? overrides.pages[0]?.id ?? null,
    },
    updateDoc: overrides.updateDoc ?? vi.fn(),
    setActivePage: overrides.setActivePage ?? vi.fn(),
    setCurrentPageId: overrides.setCurrentPageId ?? vi.fn(),
  } as unknown as ReturnType<typeof useEditor>);
}

describe('PageNav', () => {
  it('renders nothing when no pages exist', () => {
    mockEditor({ pages: [] });
    const { container } = render(<PageNav />);
    expect(container.innerHTML).toBe('');
  });

  it('renders page thumbnails when pages exist', () => {
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')];
    mockEditor({ pages, currentPageId: 'p1' });

    render(<PageNav />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-label', 'Page: Page 1');
    expect(tabs[1]).toHaveAttribute('aria-label', 'Page: Page 2');
  });

  it('marks the document active page as selected', () => {
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')];
    mockEditor({ pages, activePageId: 'p2', currentPageId: 'p1' });

    render(<PageNav />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('clicking a page activates the document page', () => {
    const setActivePage = vi.fn();
    const setCurrentPageId = vi.fn();
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')];
    mockEditor({ pages, currentPageId: 'p1', setActivePage, setCurrentPageId });

    render(<PageNav />);
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[1]!);
    expect(setActivePage).toHaveBeenCalledWith('p2');
    expect(setCurrentPageId).toHaveBeenCalledWith('p2');
  });

  it('pressing Enter on a page tab activates the document page', () => {
    const setActivePage = vi.fn();
    const setCurrentPageId = vi.fn();
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')];
    mockEditor({ pages, currentPageId: 'p1', setActivePage, setCurrentPageId });

    render(<PageNav />);
    const tabs = screen.getAllByRole('tab');
    fireEvent.keyDown(tabs[1]!, { key: 'Enter' });
    expect(setActivePage).toHaveBeenCalledWith('p2');
    expect(setCurrentPageId).toHaveBeenCalledWith('p2');
  });

  it('renders add page button', () => {
    const pages = [makePage('p1', 'Page 1')];
    mockEditor({ pages, currentPageId: 'p1' });

    render(<PageNav />);
    expect(screen.getByLabelText('Add page')).toBeTruthy();
  });

  it('opens context menu on right-click with duplicate/delete', () => {
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')];
    mockEditor({ pages, currentPageId: 'p1' });

    render(<PageNav />);
    fireEvent.contextMenu(screen.getAllByRole('tab')[0]!);

    expect(screen.getByText('Duplicate page')).toBeTruthy();
    // Two distinct deletes: the default preserves page content, discarding it
    // is a separate explicitly labelled command.
    expect(screen.getByText('Delete page (keep contents)')).toBeTruthy();
    expect(screen.getByText('Delete page and contents')).toBeTruthy();
  });

  it('allows deleting the last page but not discarding its contents', () => {
    const pages = [makePage('p1', 'Page 1')];
    mockEditor({ pages, currentPageId: 'p1' });

    render(<PageNav />);
    fireEvent.contextMenu(screen.getByRole('tab'));

    // Removing the final page returns the document to a plain canvas, so it
    // stays available; discarding the content of the only page does not,
    // since that content is the whole document.
    expect(screen.getByText('Delete page (keep contents)').closest('button')).not.toBeDisabled();
    expect(screen.getByText('Delete page and contents').closest('button')).toBeDisabled();
  });

  it('calls updateDoc (duplicatePage) from context menu', () => {
    const updateDoc = vi.fn();
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')];
    mockEditor({ pages, currentPageId: 'p1', updateDoc });

    render(<PageNav />);
    fireEvent.contextMenu(screen.getAllByRole('tab')[0]!);
    fireEvent.click(screen.getByText('Duplicate page'));

    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it('calls updateDoc (removePage) from context menu', () => {
    const updateDoc = vi.fn();
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')];
    mockEditor({ pages, currentPageId: 'p2', updateDoc });

    render(<PageNav />);
    fireEvent.contextMenu(screen.getAllByRole('tab')[1]!);
    fireEvent.click(screen.getByText('Delete page (keep contents)'));

    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it('closes context menu on Escape', () => {
    const pages = [makePage('p1', 'Page 1')];
    mockEditor({ pages, currentPageId: 'p1' });

    render(<PageNav />);
    fireEvent.contextMenu(screen.getByRole('tab'));
    expect(screen.getByText('Duplicate page')).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByText('Duplicate page')).toBeNull();
  });
});

describe('computeReorderedPageIds', () => {
  const pages = [makePage('p1', 'A'), makePage('p2', 'B'), makePage('p3', 'C')];

  it('moves the active page to the position of the over page', () => {
    const result = computeReorderedPageIds(pages, 'p1', 'p3');
    expect(result).toEqual(['p2', 'p3', 'p1']);
  });

  it('moves a page earlier in the list', () => {
    const result = computeReorderedPageIds(pages, 'p3', 'p1');
    expect(result).toEqual(['p3', 'p1', 'p2']);
  });

  it('returns null when dropped on itself', () => {
    expect(computeReorderedPageIds(pages, 'p2', 'p2')).toBeNull();
  });

  it('returns null when either id is unknown (stale drag event)', () => {
    expect(computeReorderedPageIds(pages, 'missing', 'p2')).toBeNull();
    expect(computeReorderedPageIds(pages, 'p1', 'missing')).toBeNull();
  });
});

describe('PageNav keyboard navigation', () => {
  it('ArrowRight moves focus and activates the next page', () => {
    const setActivePage = vi.fn();
    const setCurrentPageId = vi.fn();
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2'), makePage('p3', 'Page 3')];
    mockEditor({ pages, currentPageId: 'p1', setActivePage, setCurrentPageId });

    render(<PageNav />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(setActivePage).toHaveBeenCalledWith('p2');
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('tabindex', '0');
    expect(tabs[0]).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowLeft wraps to the last page', () => {
    const setActivePage = vi.fn();
    const setCurrentPageId = vi.fn();
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')];
    mockEditor({ pages, currentPageId: 'p2', setActivePage, setCurrentPageId });

    render(<PageNav />);
    const tabs = screen.getAllByRole('tab');
    fireEvent.keyDown(tabs[1]!, { key: 'ArrowLeft' });
    expect(setActivePage).toHaveBeenCalledWith('p1');
    expect(tabs[0]).toHaveFocus();
  });

  it('Home and End jump to first and last page', () => {
    const setActivePage = vi.fn();
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2'), makePage('p3', 'Page 3')];
    mockEditor({ pages, currentPageId: 'p3', setActivePage, setCurrentPageId: vi.fn() });

    render(<PageNav />);
    const tabs = screen.getAllByRole('tab');
    fireEvent.keyDown(tabs[2]!, { key: 'Home' });
    expect(tabs[0]).toHaveFocus();
    fireEvent.keyDown(tabs[0]!, { key: 'End' });
    expect(tabs[2]).toHaveFocus();
  });

  it('focus follows the roving tabindex after arrow moves', () => {
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')];
    mockEditor({ pages, currentPageId: 'p2', setActivePage: vi.fn(), setCurrentPageId: vi.fn() });

    render(<PageNav />);
    const tabs = screen.getAllByRole('tab');
    // Active page owns tabindex=0 initially.
    expect(tabs[1]).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(tabs[1]!, { key: 'ArrowRight' });
    // Wrap to first page; roving index follows focus.
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
  });
});
