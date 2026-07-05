/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTutorialDocument } from '../samples/tutorial-document';
import { TutorialBanner } from './TutorialBanner';
import { useTutorialProgress } from './TutorialFile/useTutorialProgress';

function Wrapper() {
  const progress = useTutorialProgress(createTutorialDocument());
  return <TutorialBanner progress={progress} />;
}

function NonTutorialWrapper() {
  const nonTutorial = { ...createTutorialDocument(), id: 'other-id' };
  const progress = useTutorialProgress(nonTutorial as ReturnType<typeof createTutorialDocument>);
  return <TutorialBanner progress={progress} />;
}

describe('TutorialBanner', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders when tutorial document open', () => {
    render(<Wrapper />);
    expect(screen.getByText(/Tutorial/)).toBeTruthy();
    expect(screen.getByText(/Lesson 1 of 3/)).toBeTruthy();
  });

  it('shows correct lesson number and progress', () => {
    render(<Wrapper />);
    expect(screen.getByText(/Lesson 1 of 3/)).toBeTruthy();
    expect(screen.getByText(/0%/)).toBeTruthy();
  });

  it('"Skip" button calls onComplete callback', () => {
    const doc = createTutorialDocument();
    const onComplete = vi.fn();
    function SkipWrapper() {
      const progress = useTutorialProgress(doc);
      return <TutorialBanner progress={progress} onComplete={onComplete} />;
    }
    render(<SkipWrapper />);

    const skipButton = screen.getByText('Skip');
    fireEvent.click(skipButton);

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('minimize collapses to thin bar', () => {
    render(<Wrapper />);

    const collapseButton = screen.getByLabelText('Minimize tutorial banner');
    fireEvent.click(collapseButton);

    expect(screen.getByLabelText('Expand tutorial banner')).toBeTruthy();
  });

  it('does not render when not a tutorial document', () => {
    const { container } = render(<NonTutorialWrapper />);
    expect(container.firstChild).toBeNull();
  });

  it('respects prefers-reduced-motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    render(<Wrapper />);
    expect(screen.getByText(/Tutorial/)).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
