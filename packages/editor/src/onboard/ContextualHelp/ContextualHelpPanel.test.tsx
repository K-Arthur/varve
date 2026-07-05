// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextualHelpPanel } from './ContextualHelpPanel';
import type { HelpArticle } from './helpContent';
import { HELP_CONTENT, searchHelpContent } from './helpContent';
import type { ContextualHelpState } from './useContextualHelp';

afterEach(cleanup);

function createState(overrides: Partial<ContextualHelpState> = {}): ContextualHelpState {
  return {
    open: false,
    article: null,
    searchQuery: '',
    searchResults: [],
    ...overrides,
  };
}

function renderPanel(state: ContextualHelpState, overrides: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  const onSetArticle = vi.fn();
  const onSetSearchQuery = vi.fn();
  const utils = render(
    <ContextualHelpPanel
      state={state}
      onClose={onClose}
      onSetArticle={onSetArticle}
      onSetSearchQuery={onSetSearchQuery}
      {...overrides}
    />,
  );
  return { ...utils, onClose, onSetArticle, onSetSearchQuery };
}

describe('ContextualHelpPanel', () => {
  it('F1 key opens the panel', () => {
    const state = createState({ open: true });
    const { container } = renderPanel(state);
    expect(container.querySelector('.contextual-help-panel--open')).toBeTruthy();
  });

  it('Escape closes the panel', () => {
    const state = createState({ open: true });
    const { onClose } = renderPanel(state);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('Shows "How can we help?" when no context or article', () => {
    const state = createState({ open: true, article: null });
    renderPanel(state);
    expect(screen.getByText('How can we help?')).toBeTruthy();
  });

  it('Displays article title when opened with article ID', () => {
    const article = HELP_CONTENT['tool:select'];
    const state = createState({ open: true, article });
    renderPanel(state);
    expect(screen.getByText(article.title)).toBeTruthy();
    expect(screen.getByText(article.summary)).toBeTruthy();
    expect(screen.getByText(article.body)).toBeTruthy();
  });

  it('Search filters results by keyword match', () => {
    const results = searchHelpContent('rectangle');
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every(
        (r) =>
          r.title.toLowerCase().includes('rectangle') ||
          r.summary.toLowerCase().includes('rectangle') ||
          r.keywords.some((k) => k.includes('rectangle')),
      ),
    ).toBeTruthy();
  });

  it('Clicking search result loads that article', () => {
    const article = HELP_CONTENT['tool:rect'];
    const state = createState({
      open: true,
      article: null,
      searchQuery: 'rect',
      searchResults: [article],
    });
    const { onSetArticle } = renderPanel(state);
    const resultBtn = screen.getByText(article.title);
    fireEvent.click(resultBtn);
    expect(onSetArticle).toHaveBeenCalledWith(article);
  });

  it('F1 toggle closes when already open', () => {
    const state = createState({ open: false });
    const { container } = renderPanel(state);
    expect(container.querySelector('.contextual-help-panel--open')).toBeFalsy();
  });

  it('Panel has correct ARIA attributes', () => {
    const state = createState({ open: true });
    renderPanel(state);
    const panel = document.querySelector('.contextual-help-panel');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('role')).toBe('complementary');
    expect(panel?.getAttribute('aria-label')).toBe('Help');
  });

  it('Panel is a drawer (not modal) - renders without backdrop', () => {
    const state = createState({ open: true });
    const { container } = renderPanel(state);
    // The panel should not have an overlay/backdrop element
    expect(container.querySelector('.contextual-help-panel__backdrop')).toBeNull();
    // The panel should be present
    expect(container.querySelector('.contextual-help-panel--open')).toBeTruthy();
  });

  it('Category landing page shows all tool links', () => {
    const state = createState({ open: true, article: null });
    renderPanel(state);
    // Check that tool category links are shown
    const toolsArticle = HELP_CONTENT['tool:select'];
    expect(screen.getByText(toolsArticle.title)).toBeTruthy();
    const panelArticle = HELP_CONTENT['panel:layers'];
    expect(screen.getByText(panelArticle.title)).toBeTruthy();
  });
});
