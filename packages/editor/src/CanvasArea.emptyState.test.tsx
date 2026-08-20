// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { EmptyState } from '@varve/ui';
import { describe, expect, it } from 'vitest';
import { getEmptyStateContent } from './CanvasArea';

describe('getEmptyStateContent', () => {
  it('returns design mode defaults for unknown mode', () => {
    const content = getEmptyStateContent('unknown');
    expect(content.title).toBe('Start designing');
    expect(content.shortcuts).toEqual([
      { key: 'F', label: 'Frame' },
      { key: 'R', label: 'Rectangle' },
      { key: 'T', label: 'Text' },
      { key: 'P', label: 'Pen' },
    ]);
    expect(content.hint).toBe('or drag an image here');
  });

  it('returns correct content for design mode', () => {
    const content = getEmptyStateContent('design');
    expect(content.title).toBe('Start designing');
    expect(content.shortcuts).toHaveLength(4);
    expect(content.hint).toBe('or drag an image here');
  });

  it('returns correct content for drawing mode', () => {
    const content = getEmptyStateContent('drawing');
    expect(content.title).toBe('Start painting');
    expect(content.shortcuts).toEqual([
      { key: 'B', label: 'Brush' },
      { key: '⇧P', label: 'Pencil' },
      { key: 'E', label: 'Eraser' },
    ]);
  });

  it('returns correct content for print mode', () => {
    const content = getEmptyStateContent('print');
    expect(content.title).toBe('Start your layout');
    expect(content.shortcuts).toHaveLength(3);
    expect(content.hint).toBe('or drag an image to place');
  });

  it('returns correct content for motion mode', () => {
    const content = getEmptyStateContent('motion');
    expect(content.title).toBe('Create your first scene');
    expect(content.hint).toBe('or drag images to animate');
  });

  it('returns correct content for codegen mode', () => {
    const content = getEmptyStateContent('codegen');
    expect(content.title).toBe('Select artwork to export');
    expect(content.shortcuts).toHaveLength(1);
    expect(content.hint).toBe('then choose a code format in the Export panel');
  });

  it('returns correct content for logo mode', () => {
    const content = getEmptyStateContent('logo');
    expect(content.title).toBe('Design your mark');
    expect(content.shortcuts).toHaveLength(4);
    expect(content.hint).toBe('or start from a template');
  });

  it('returns correct content for image mode', () => {
    const content = getEmptyStateContent('image');
    expect(content.title).toBe('Edit your photo');
    expect(content.shortcuts).toHaveLength(1);
  });
});

describe('CanvasArea empty state', () => {
  it('renders empty state with headline', () => {
    render(
      <EmptyState
        illustration={
          <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden>
            <title>Empty canvas</title>
            <rect
              x="10"
              y="12"
              width="60"
              height="56"
              rx="4"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              opacity="0.3"
            />
            <path
              d="M30 30 L50 30 M30 38 L45 38 M30 46 L40 46"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.4"
            />
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
        illustration={
          <svg width="80" height="80" aria-hidden>
            <title>Empty canvas</title>
          </svg>
        }
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
        illustration={
          <svg width="64" height="64" aria-hidden>
            <title>Test</title>
          </svg>
        }
        headline="Test headline"
        description="Test description"
      />,
    );
    const headline = screen.getByText('Test headline');
    expect(headline.tagName).toBe('H3');
    expect(headline.className).toContain('varve-empty__headline');
  });
});

describe('Canvas inline empty state', () => {
  function renderEmptyState(mode: string) {
    const content = getEmptyStateContent(mode);
    return render(
      <div className="editor-canvas__empty-state" role="status" aria-label="Empty canvas">
        <p className="editor-canvas__empty-state-title">{content.title}</p>
        <div className="editor-canvas__empty-state-shortcuts">
          {content.shortcuts.map((s) => (
            <span key={s.key}>
              <span className="editor-canvas__empty-state-key">{s.key}</span>
              {s.label}
            </span>
          ))}
        </div>
        <p className="editor-canvas__empty-state-hint">{content.hint}</p>
      </div>,
    );
  }

  it('renders design mode shortcut hints', () => {
    renderEmptyState('design');
    expect(screen.getByText('Start designing')).toBeTruthy();
    expect(screen.getByText('Frame')).toBeTruthy();
    expect(screen.getByText('Rectangle')).toBeTruthy();
    expect(screen.getByText('Text')).toBeTruthy();
    expect(screen.getByText('Pen')).toBeTruthy();
    expect(screen.getByText('or drag an image here')).toBeTruthy();
  });

  it('renders drawing mode shortcut hints', () => {
    renderEmptyState('drawing');
    expect(screen.getByText('Start painting')).toBeTruthy();
    expect(screen.getByText('Brush')).toBeTruthy();
    expect(screen.getByText('Pencil')).toBeTruthy();
    expect(screen.getByText('Eraser')).toBeTruthy();
  });

  it('renders motion mode shortcut hints', () => {
    renderEmptyState('motion');
    expect(screen.getByText('Create your first scene')).toBeTruthy();
    expect(screen.getByText('or drag images to animate')).toBeTruthy();
  });

  it('renders codegen mode shortcut hints', () => {
    renderEmptyState('codegen');
    expect(screen.getByText('Select artwork to export')).toBeTruthy();
    expect(screen.getByText('then choose a code format in the Export panel')).toBeTruthy();
  });

  it('has role=status for screen readers', () => {
    renderEmptyState('design');
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Empty canvas');
  });
});
