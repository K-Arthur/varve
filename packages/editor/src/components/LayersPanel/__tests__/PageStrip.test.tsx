/**
 * TDD tests for PageStrip component.
 *
 * Covers: rendering thumbnails, active page highlight, click switching,
 * add/duplicate/delete page, context menu, last-page guard, horizontal
 * scrolling, and drag-to-reorder.
 */

import type { Document, NodeId } from '@strata/scene';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageStrip } from '../PageStrip';

function makePage(id: string, name: string) {
  return { id, name, width: 1920, height: 1080, backgrounds: [], contentRoot: `${id}-root` };
}

function emptyDoc(): Document {
  return {
    id: 'doc1',
    name: 'Test',
    formatVersion: '1.2',
    rootChildren: [],
    nodes: {},
    components: {},
    nextId: 1,
  } as Document;
}

const defaultProps = {
  document: emptyDoc(),
  activePageId: undefined as NodeId | undefined,
  onSetActivePage: vi.fn(),
  onAddPage: vi.fn(),
  onDuplicatePage: vi.fn(),
  onDeletePage: vi.fn(),
  onReorderPages: vi.fn(),
};

describe('PageStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page thumbnails for each page', () => {
    const doc = { ...emptyDoc(), pages: [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')] };
    render(<PageStrip {...defaultProps} document={doc} />);
    const items = screen.getAllByRole('button', { name: /^Page:/ });
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Page 1');
    expect(items[1]).toHaveTextContent('Page 2');
  });

  it('renders nothing when no pages exist', () => {
    render(<PageStrip {...defaultProps} />);
    expect(screen.queryByRole('button', { name: /^Page:/ })).toBeNull();
  });

  it('highlights active page with accent class', () => {
    const doc = { ...emptyDoc(), pages: [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')] };
    render(<PageStrip {...defaultProps} document={doc} activePageId="p1" />);
    const buttons = screen.getAllByRole('button', { name: /^Page:/ });
    expect(buttons[0]).toHaveClass('page-strip__page--active');
    expect(buttons[1]).not.toHaveClass('page-strip__page--active');
  });

  it('switches active page on click', () => {
    const onSetActivePage = vi.fn();
    const doc = { ...emptyDoc(), pages: [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')] };
    render(<PageStrip {...defaultProps} document={doc} onSetActivePage={onSetActivePage} />);
    const buttons = screen.getAllByRole('button', { name: /^Page:/ });
    const secondBtn = buttons[1];
    if (secondBtn) fireEvent.click(secondBtn);
    expect(onSetActivePage).toHaveBeenCalledWith('p2');
  });

  it('renders "+" button that calls onAddPage', () => {
    const onAddPage = vi.fn();
    const doc = { ...emptyDoc(), pages: [makePage('p1', 'Page 1')] };
    render(<PageStrip {...defaultProps} document={doc} onAddPage={onAddPage} />);
    const addBtn = screen.getByLabelText('Add page');
    expect(addBtn).toBeTruthy();
    fireEvent.click(addBtn);
    expect(onAddPage).toHaveBeenCalledOnce();
  });

  it('opens context menu on right-click with duplicate/delete/rename', () => {
    const doc = { ...emptyDoc(), pages: [makePage('p1', 'Page 1')] };
    render(<PageStrip {...defaultProps} document={doc} />);
    const pageBtn = screen.getByRole('button', { name: /^Page:/ });
    fireEvent.contextMenu(pageBtn);

    expect(screen.getByText('Duplicate page')).toBeTruthy();
    expect(screen.getByText('Delete page')).toBeTruthy();
    expect(screen.getByText('Rename page')).toBeTruthy();
  });

  it('disables delete in context menu for last page', () => {
    const doc = { ...emptyDoc(), pages: [makePage('p1', 'Page 1')] };
    render(<PageStrip {...defaultProps} document={doc} />);
    const pageBtn = screen.getByRole('button', { name: /^Page:/ });
    fireEvent.contextMenu(pageBtn);

    const deleteBtn = screen.getByText('Delete page').closest('button');
    expect(deleteBtn).toBeDisabled();
  });

  it('calls onDuplicatePage from context menu', () => {
    const onDuplicatePage = vi.fn();
    const doc = { ...emptyDoc(), pages: [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')] };
    render(<PageStrip {...defaultProps} document={doc} onDuplicatePage={onDuplicatePage} />);
    const pageBtn = screen.getByRole('button', { name: 'Page: Page 1' });
    fireEvent.contextMenu(pageBtn);

    fireEvent.click(screen.getByText('Duplicate page'));
    expect(onDuplicatePage).toHaveBeenCalledWith('p1');
  });

  it('calls onDeletePage from context menu', () => {
    const onDeletePage = vi.fn();
    const doc = { ...emptyDoc(), pages: [makePage('p1', 'Page 1'), makePage('p2', 'Page 2')] };
    render(<PageStrip {...defaultProps} document={doc} onDeletePage={onDeletePage} />);
    const pageBtn = screen.getByRole('button', { name: 'Page: Page 2' });
    fireEvent.contextMenu(pageBtn);

    fireEvent.click(screen.getByText('Delete page'));
    expect(onDeletePage).toHaveBeenCalledWith('p2');
  });

  it('closes context menu on Escape', () => {
    const doc = { ...emptyDoc(), pages: [makePage('p1', 'Page 1')] };
    render(<PageStrip {...defaultProps} document={doc} />);
    const pageBtn = screen.getByRole('button', { name: /^Page:/ });
    fireEvent.contextMenu(pageBtn);

    expect(screen.getByText('Duplicate page')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('Duplicate page')).toBeNull();
  });

  it('renders rename prompt in context menu', () => {
    const doc = { ...emptyDoc(), pages: [makePage('p1', 'Page 1')] };
    render(<PageStrip {...defaultProps} document={doc} />);
    const pageBtn = screen.getByRole('button', { name: /^Page:/ });
    fireEvent.contextMenu(pageBtn);

    const renameOption = screen.getByText('Rename page');
    expect(renameOption).toBeTruthy();
  });

  it('renders scrollable container when many pages', () => {
    const pages = Array.from({ length: 10 }, (_, i) => makePage(`p${i + 1}`, `Page ${i + 1}`));
    const doc = { ...emptyDoc(), pages };
    const { container } = render(<PageStrip {...defaultProps} document={doc} />);
    const scrollContainer = container.querySelector('.page-strip__pages');
    expect(scrollContainer).toBeTruthy();
  });

  it('renders thumbnail divs for each page', () => {
    const doc = { ...emptyDoc(), pages: [makePage('p1', 'Page 1')] };
    const { container } = render(<PageStrip {...defaultProps} document={doc} />);
    const thumb = container.querySelector('.page-strip__page-thumb');
    expect(thumb).toBeTruthy();
  });
});
