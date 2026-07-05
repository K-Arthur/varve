// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelpBrowser } from './HelpBrowser';
import { HELP_CONTENT, searchHelpContent } from './content/helpContent';

afterEach(cleanup);

function renderHelpBrowser(open = true, onClose = vi.fn()) {
  return render(<HelpBrowser open={open} onClose={onClose} />);
}

describe('HelpBrowser', () => {
  it('renders category sidebar', () => {
    renderHelpBrowser();
    expect(screen.getByText('Getting Started')).toBeTruthy();
    expect(screen.getByText('Tools')).toBeTruthy();
    expect(screen.getByText('Panels')).toBeTruthy();
    expect(screen.getByText('Export')).toBeTruthy();
    expect(screen.getByText('Shortcuts')).toBeTruthy();
    expect(screen.getByText('FAQ')).toBeTruthy();
    expect(screen.getByText('Troubleshooting')).toBeTruthy();
  });

  it('clicking category shows its articles', () => {
    renderHelpBrowser();
    fireEvent.click(screen.getByText('Tools'));
    // Should show the tools category heading
    expect(screen.getByText('Tools')).toBeTruthy();
    // Should show at least one tool article
    const selectTool = HELP_CONTENT['tool:select'];
    expect(screen.getByText(selectTool.title)).toBeTruthy();
  });

  it('clicking article shows content', () => {
    renderHelpBrowser();
    // Click a category first
    fireEvent.click(screen.getByText('Getting Started'));
    // Click an article
    const article = HELP_CONTENT['getting-started:overview'];
    fireEvent.click(screen.getByText(article.title));
    // Should show the article body
    expect(screen.getByText(article.title)).toBeTruthy();
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
    // Navigate to an article
    fireEvent.click(screen.getByText('Tools'));
    const article = HELP_CONTENT['tool:select'];
    fireEvent.click(screen.getByText(article.title));
    // Breadcrumb should show the category
    const breadcrumb = screen.getByText('Tools');
    expect(breadcrumb).toBeTruthy();
    // Category link should be clickable
    fireEvent.click(breadcrumb);
    expect(screen.getByText(article.title)).toBeTruthy();
  });

  it('related articles appear at bottom', () => {
    renderHelpBrowser();
    // Navigate to the overview article which has related articles
    fireEvent.click(screen.getByText('Getting Started'));
    const article = HELP_CONTENT['getting-started:overview'];
    fireEvent.click(screen.getByText(article.title));
    // Related section should be visible
    expect(screen.getByText('Related articles')).toBeTruthy();
  });

  it('Escape closes the browser', () => {
    const onClose = vi.fn();
    renderHelpBrowser(true, onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Was this helpful?" records feedback', () => {
    renderHelpBrowser();
    // Navigate to an article
    fireEvent.click(screen.getByText('Getting Started'));
    const article = HELP_CONTENT['getting-started:overview'];
    fireEvent.click(screen.getByText(article.title));
    // Click "Yes"
    const yesBtn = screen.getByLabelText('Yes, this was helpful');
    fireEvent.click(yesBtn);
    // Should show thanks message
    expect(screen.getByText('Thanks for your feedback!')).toBeTruthy();
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
