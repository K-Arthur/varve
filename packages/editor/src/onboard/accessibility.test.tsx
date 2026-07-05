// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextualHelpPanel } from './ContextualHelp/ContextualHelpPanel';
import { HELP_CONTENT } from './ContextualHelp/helpContent';
import type { ContextualHelpState } from './ContextualHelp/useContextualHelp';
import { DidYouKnowTip } from './DidYouKnow/DidYouKnowTip';
import type { Tip } from './DidYouKnow/tips';
import { NewFeatureBadge } from './NewFeatureBadge/NewFeatureBadge';
import { OnboardingChecklist } from './OnboardingChecklist/OnboardingChecklist';
import { TutorialBanner } from './TutorialBanner';
import { WelcomeDialog } from './WelcomeDialog/WelcomeDialog';

afterEach(cleanup);

function createHelpState(overrides: Partial<ContextualHelpState> = {}): ContextualHelpState {
  return { open: true, article: null, searchQuery: '', searchResults: [], ...overrides };
}

function makeTip(overrides: Partial<Tip> = {}): Tip {
  return {
    id: 'test-tip',
    title: 'Test Tip',
    body: 'Test tip body.',
    category: 'shortcuts',
    ...overrides,
  };
}

describe('accessibility integration', () => {
  it('WelcomeDialog has dialog role and aria-labelledby', () => {
    render(
      <WelcomeDialog
        open={true}
        onStartTour={vi.fn()}
        onStartTemplate={vi.fn()}
        onStartBlank={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The dialog should have an aria-labelledby pointing to the title
    expect(dialog).toHaveAttribute('aria-labelledby');
  });

  it('OnboardingChecklist has region role and aria-label', () => {
    render(
      <OnboardingChecklist
        open={true}
        onClose={vi.fn()}
        progress={[]}
        onItemClick={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const region = screen.getByRole('region');
    expect(region).toHaveAttribute('aria-label', 'Getting started checklist');
  });

  it('ContextualHelpPanel has complementary role', () => {
    render(
      <ContextualHelpPanel
        state={createHelpState()}
        onClose={vi.fn()}
        onSetArticle={vi.fn()}
        onSetSearchQuery={vi.fn()}
      />,
    );
    const panel = screen.getByRole('complementary');
    expect(panel).toHaveAttribute('aria-label', 'Help');
  });

  it('DidYouKnowTip has status role and aria-live', () => {
    render(<DidYouKnowTip tip={makeTip()} onDismiss={vi.fn()} onDontShowAgain={vi.fn()} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('TutorialBanner has status role', () => {
    const progress = {
      currentLesson: 1,
      totalLessons: 3,
      completedLessons: new Set<string>(),
      markLessonComplete: vi.fn(),
      isTutorialDoc: true,
      progressPercent: 33,
    };
    render(<TutorialBanner progress={progress} />);
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
  });

  it('NewFeatureBadge has correct aria-label on badge dot', () => {
    const { container } = render(
      <NewFeatureBadge featureId="tool:pen" lastSeenVersion="0.5.0">
        <button type="button">Pen</button>
      </NewFeatureBadge>,
    );
    const badge = container.querySelector('.new-feature-badge__dot');
    expect(badge).toHaveAttribute('aria-label', 'New: tool:pen');
  });

  it('SVG illustrations have aria-hidden', () => {
    // DidYouKnowTip renders an SVG info icon with aria-hidden
    render(
      <DidYouKnowTip
        tip={{ id: 't', title: 'T', body: 'B', category: 'shortcuts' }}
        onDismiss={vi.fn()}
        onDontShowAgain={vi.fn()}
      />,
    );
    const hiddenSvg = document.querySelector('.did-you-know-tip svg[aria-hidden="true"]');
    expect(hiddenSvg).toBeTruthy();
  });

  it('Progress bars have aria-valuenow/valuemin/valuemax', () => {
    const progress = {
      currentLesson: 1,
      totalLessons: 3,
      completedLessons: new Set<string>(),
      markLessonComplete: vi.fn(),
      isTutorialDoc: true,
      progressPercent: 33,
    };
    render(<TutorialBanner progress={progress} />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '33');
    expect(progressBar).toHaveAttribute('aria-valuemin', '0');
    expect(progressBar).toHaveAttribute('aria-valuemax', '100');
  });
});
