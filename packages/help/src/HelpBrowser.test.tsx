// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HELP_CONTENT, searchHelpContent } from './content/helpContent';
import { HelpBrowser } from './HelpBrowser';

afterEach(cleanup);

function renderHelpBrowser(open = true, onClose = vi.fn()) {
  return render(<HelpBrowser open={open} onClose={onClose} />);
}

/** Click a sidebar category button by its text content. */
function clickSidebarCategory(name: string) {
  const nav = screen.getByLabelText('Categories');
  const all = nav.querySelectorAll<HTMLButtonElement>('button.help-browser__category');
  for (const b of all) {
    const span = b.querySelector('.help-browser__category-name');
    if (span?.textContent?.trim() === name) {
      fireEvent.click(b);
      return;
    }
  }
  throw new Error(`Sidebar category "${name}" not found`);
}

function getArticle(id: string) {
  const a = HELP_CONTENT[id];
  if (!a) throw new Error(`Article ${id} not found`);
  return a;
}

describe('HelpBrowser', () => {
  it('renders category sidebar', () => {
    const { container } = renderHelpBrowser();
    const sidebar = container.querySelector('.help-browser__sidebar');
    expect(sidebar).toBeTruthy();
    expect(sidebar?.textContent).toContain('Getting Started');
    expect(sidebar?.textContent).toContain('Tools');
    expect(sidebar?.textContent).toContain('Panels');
    expect(sidebar?.textContent).toContain('Export');
    expect(sidebar?.textContent).toContain('Shortcuts');
    expect(sidebar?.textContent).toContain('FAQ');
    expect(sidebar?.textContent).toContain('Troubleshooting');
  });

  it('clicking category shows its articles', () => {
    renderHelpBrowser();
    clickSidebarCategory('Tools');
    const selectTool = getArticle('tool:select');
    expect(screen.getByText(selectTool.title)).toBeTruthy();
  });

  it('clicking article shows content', async () => {
    renderHelpBrowser();
    clickSidebarCategory('Getting Started');
    const article = getArticle('getting-started:overview');
    await waitFor(() => {
      const cards = screen.getAllByText(article.title);
      expect(cards.length).toBeGreaterThanOrEqual(1);
    });
    const cards = screen.getAllByText(article.title);
    fireEvent.click(cards[0] as HTMLElement);
    await waitFor(() => {
      const titles = screen.getAllByText(article.title);
      expect(titles.length).toBeGreaterThanOrEqual(1);
    });
    const titleEl = screen.getAllByText(article.title)[0];
    expect(titleEl?.closest('.help-browser__article')).toBeTruthy();
  });

  it('search filters by keyword match', () => {
    renderHelpBrowser();
    const input = screen.getByPlaceholderText('Search help...');
    fireEvent.change(input, { target: { value: 'rectangle' } });
    const results = searchHelpContent('rectangle');
    expect(results.length).toBeGreaterThan(0);
  });

  it('breadcrumbs show correct path', () => {
    renderHelpBrowser();
    clickSidebarCategory('Tools');
    const article = getArticle('tool:select');
    fireEvent.click(screen.getByText(article.title));
    const breadcrumbLinks = document.querySelectorAll('.help-browser__breadcrumb-link');
    let found = false;
    for (const el of breadcrumbLinks) {
      if (el.textContent?.trim() === 'Tools') {
        found = true;
        fireEvent.click(el);
        break;
      }
    }
    expect(found).toBe(true);
    expect(screen.getByText(article.title)).toBeTruthy();
  });

  it('related articles appear at bottom', async () => {
    renderHelpBrowser();
    clickSidebarCategory('Getting Started');
    const article = getArticle('getting-started:overview');
    await waitFor(() => {
      expect(screen.getAllByText(article.title).length).toBeGreaterThanOrEqual(1);
    });
    const relatedCards = screen.getAllByText(article.title);
    fireEvent.click(relatedCards[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByText('Related articles')).toBeTruthy();
    });
  });

  it('Escape closes the browser', () => {
    const onClose = vi.fn();
    renderHelpBrowser(true, onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Was this helpful?" records feedback', async () => {
    renderHelpBrowser();
    clickSidebarCategory('Getting Started');
    const article = getArticle('getting-started:overview');
    await waitFor(() => {
      expect(screen.getAllByText(article.title).length).toBeGreaterThanOrEqual(1);
    });
    const helpfulCards = screen.getAllByText(article.title);
    fireEvent.click(helpfulCards[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByLabelText('Yes, this was helpful')).toBeTruthy();
    });
    const yesBtn = screen.getByLabelText('Yes, this was helpful');
    fireEvent.click(yesBtn);
    await waitFor(() => {
      expect(screen.getByText('Thanks for your feedback!')).toBeTruthy();
    });
  });

  it('does not render when closed', () => {
    const { container } = renderHelpBrowser(false);
    expect(container.querySelector('.help-browser')).toBeNull();
  });

  it('has correct ARIA attributes', () => {
    renderHelpBrowser();
    const dialog = document.querySelector('.help-browser');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-label')).toBe('Help');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
  });
});
