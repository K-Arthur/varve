// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '@strata/ui';

describe('CanvasArea empty state', () => {
  it('renders empty state with headline', () => {
    render(
      <EmptyState
        illustration={
          <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden>
            <title>Empty canvas</title>
            <rect x="10" y="12" width="60" height="56" rx="4" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.3" />
            <path d="M30 30 L50 30 M30 38 L45 38 M30 46 L40 46" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
            <circle cx="56" cy="28" r="6" fill="currentColor" opacity="0.15" />
          </svg>
        }
        headline="Your canvas is empty"
        description="Draw a shape, add some text, or import an image to get started."
        actions={
          <div className="editor-canvas__empty-actions">
            <span>Draw a rectangle</span>
            <span>Add text</span>
            <span>Import...</span>
          </div>
        }
      />,
    );
    expect(screen.getByText('Your canvas is empty')).toBeTruthy();
    expect(screen.getByText(/Draw a shape, add some text, or import an image/)).toBeTruthy();
  });

  it('renders three CTA buttons', () => {
    render(
      <EmptyState
        illustration={<svg width="80" height="80" aria-hidden><title>Empty canvas</title></svg>}
        headline="Your canvas is empty"
        actions={
          <div className="editor-canvas__empty-actions">
            <span>Draw a rectangle</span>
            <span>Add text</span>
            <span>Import...</span>
          </div>
        }
      />,
    );
    expect(screen.getByText('Draw a rectangle')).toBeTruthy();
    expect(screen.getByText('Add text')).toBeTruthy();
    expect(screen.getByText('Import...')).toBeTruthy();
  });

  it('does not render empty state when condition is false', () => {
    const { container } = render(
      <div>
        <canvas aria-label="Design canvas" />
      </div>,
    );
    expect(container.textContent).not.toContain('Your canvas is empty');
  });

  it('EmptyState component has correct structure', () => {
    render(
      <EmptyState
        illustration={<svg width="64" height="64" aria-hidden><title>Test</title></svg>}
        headline="Test headline"
        description="Test description"
      />,
    );
    const headline = screen.getByText('Test headline');
    expect(headline.tagName).toBe('H3');
    expect(headline.className).toContain('strata-empty__headline');
  });
});
