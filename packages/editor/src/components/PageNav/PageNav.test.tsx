import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageNav } from './PageNav';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

import { useEditor } from '../../context';

function makePage(id: string, name: string) {
  return { id, name, width: 1920, height: 1080, backgrounds: [], contentRoot: `${id}-root` };
}

describe('PageNav', () => {
  it('renders nothing when no pages exist', () => {
    vi.mocked(useEditor).mockReturnValue({
      state: {
        document: { pages: [] },
        currentPageId: null,
      },
      updateDoc: vi.fn(),
      setCurrentPageId: vi.fn(),
    } as unknown as ReturnType<typeof useEditor>);

    const { container } = render(<PageNav />);
    expect(container.innerHTML).toBe('');
  });

  it('renders page thumbnails when pages exist', () => {
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')];
    vi.mocked(useEditor).mockReturnValue({
      state: {
        document: { pages },
        currentPageId: 'p1',
      },
      updateDoc: vi.fn(),
      setCurrentPageId: vi.fn(),
    } as unknown as ReturnType<typeof useEditor>);

    render(<PageNav />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-label', 'Page: Page 1');
    expect(tabs[1]).toHaveAttribute('aria-label', 'Page: Page 2');
  });

  it('clicking a page calls setCurrentPageId', () => {
    const setCurrentPageId = vi.fn();
    const pages = [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')];
    vi.mocked(useEditor).mockReturnValue({
      state: {
        document: { pages },
        currentPageId: 'p1',
      },
      updateDoc: vi.fn(),
      setCurrentPageId,
    } as unknown as ReturnType<typeof useEditor>);

    render(<PageNav />);
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[1]!);
    expect(setCurrentPageId).toHaveBeenCalledWith('p2');
  });

  it('renders add page button', () => {
    const pages = [makePage('p1', 'Page 1')];
    vi.mocked(useEditor).mockReturnValue({
      state: {
        document: { pages },
        currentPageId: 'p1',
      },
      updateDoc: vi.fn(),
      setCurrentPageId: vi.fn(),
    } as unknown as ReturnType<typeof useEditor>);

    render(<PageNav />);
    expect(screen.getByLabelText('Add page')).toBeTruthy();
  });
});
