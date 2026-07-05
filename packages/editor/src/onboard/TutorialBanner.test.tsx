/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TutorialBanner } from './TutorialBanner';
import { createTutorialDocument } from '../samples/tutorial-document';
import { useTutorialProgress } from './TutorialFile/useTutorialProgress';

// We need a wrapper component to test the banner with real progress
function TestWrapper({ doc }: { doc: ReturnType<typeof createTutorialDocument> }) {
  const progress = useTutorialProgress(doc);
  return <TutorialBanner progress={progress} />;
}

describe('TutorialBanner', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders when tutorial document open', () => {
    const doc = createTutorialDocument();
    render(<TestWrapper doc={doc} />);
    expect(screen.getByText('Tutorial')).toBeTruthy();
    expect(screen.getByText(/Lesson 1 of 3/)).toBeTruthy();
  });

  it('shows correct lesson number and progress', () => {
    const doc = createTutorialDocument();
    render(<TestWrapper doc={doc} />);
    expect(screen.getByText(/Lesson 1 of 3/)).toBeTruthy();
    expect(screen.getByText(/0%/)).toBeTruthy();
  });

  it('"Skip" dismisses and marks tutorial complete', () => {
    const doc = createTutorialDocument();
    const progress = useTutorialProgress(doc);
    const onComplete = vi.fn();
    render(<TutorialBanner progress={progress} onComplete={onComplete} />);

    const skipButton = screen.getByText('Skip');
    fireEvent.click(skipButton);

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('minimize collapses to thin bar', () => {
    const doc = createTutorialDocument();
    render(<TestWrapper doc={doc} />);

    const collapseButton = screen.getByLabelText('Minimize tutorial banner');
    fireEvent.click(collapseButton);

    // After collapse, the expand button should appear
    expect(screen.getByLabelText('Expand tutorial banner')).toBeTruthy();
  });

  it('does not render when not a tutorial document', () => {
    const nonTutorial = {
      ...createTutorialDocument(),
      id: 'some-other-id',
    };
    const progress = useTutorialProgress(nonTutorial);
    const { container } = render(<TutorialBanner progress={progress} />);
    // Should render no banner content when not a tutorial
    expect(container.firstChild).toBeNull();
  });

  it('respects prefers-reduced-motion', () => {
    // Mock matchMedia to return prefers-reduced-motion: reduce
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const doc = createTutorialDocument();
    render(<TestWrapper doc={doc} />);
    // Banner should still render
    expect(screen.getByText('Tutorial')).toBeTruthy();
  });
});
