import type { Page } from '@strata/scene';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { computeReorderedPageIds, PageNav } from './PageNav';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

import { useEditor } from '../../context';

function makePage(id: string, name: string): Page {
  return { id, name, width: 1920, height: 1080, backgrounds: [], contentRoot: `${id}-root` };
}

function mockEditor(overrides: {
  pages: Page[];
  currentPageId?: string | null;
  updateDoc?: ReturnType<typeof vi.fn>;
  setCurrentPageId?: ReturnType<typeof vi.fn>;
}) {
  vi.mocked(useEditor).mockReturnValue({
    state: {
      document: { pages: overrides.pages },
      currentPageId: overrides.currentPageId ?? overrides.pages[0]?.id ?? null,
    },
    updateDoc: overrides.updateDoc ?? vi.fn(),
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

  it('clicking a page calls setCurrentPageId', () => {
    const setCurrentPageId = vi.fn();
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')];
    mockEditor({ pages, currentPageId: 'p1', setCurrentPageId });

    render(<PageNav />);
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[1]!);
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
    expect(screen.getByText('Delete page')).toBeTruthy();
  });

  it('disables delete in context menu for the last remaining page', () => {
    const pages = [makePage('p1', 'Page 1')];
    mockEditor({ pages, currentPageId: 'p1' });

    render(<PageNav />);
    fireEvent.contextMenu(screen.getByRole('tab'));

    const deleteBtn = screen.getByText('Delete page').closest('button');
    expect(deleteBtn).toBeDisabled();
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
    fireEvent.click(screen.getByText('Delete page'));

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
