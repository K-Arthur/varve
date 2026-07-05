import { Icon } from '@strata/ui';
import { useCallback, useState } from 'react';
import type { TutorialProgress } from './TutorialFile/useTutorialProgress';
import './TutorialBanner.css';

const LESSON_INSTRUCTIONS: Record<string, string> = {
  'Lesson 1': 'Try clicking on shapes, editing text, and changing colors in the inspector panel.',
  'Lesson 2':
    'Drag layers in the left panel to reorder. Try selecting different shapes in the canvas.',
  'Lesson 3':
    'Open the File menu or press Ctrl+E to explore export options for your design.',
};

function getInstruction(lessonIndex: number): string {
  const key = `Lesson ${lessonIndex}`;
  return LESSON_INSTRUCTIONS[key] ?? 'Follow the instructions in this lesson.';
}

export interface TutorialBannerProps {
  progress: TutorialProgress;
  onComplete?: () => void;
}

export function TutorialBanner({ progress, onComplete }: TutorialBannerProps) {
  const [minimized, setMinimized] = useState(false);

  const handleSkip = useCallback(() => {
    if (onComplete) onComplete();
  }, [onComplete]);

  const handleToggleMinimize = useCallback(() => {
    setMinimized((v) => !v);
  }, []);

  if (!progress.isTutorialDoc) return null;

  const instruction = getInstruction(progress.currentLesson);

  return (
    <div
      className={`tutorial-banner ${minimized ? 'tutorial-banner--minimized' : ''}`}
      role="status"
      aria-live="polite"
    >
      {minimized ? (
        <button
          type="button"
          className="tutorial-banner__expand"
          onClick={handleToggleMinimize}
          aria-label="Expand tutorial banner"
        >
          <Icon name="ChevronDown" label="" />
          <span>Tutorial</span>
        </button>
      ) : (
        <div className="tutorial-banner__content">
          <div className="tutorial-banner__header">
            <div className="tutorial-banner__title-row">
              <Icon name="GraduationCap" label="" />
              <span className="tutorial-banner__label">
                Tutorial &mdash; Lesson {progress.currentLesson} of {progress.totalLessons}
              </span>
            </div>
            <div className="tutorial-banner__actions">
              <span className="tutorial-banner__progress-text">{progress.progressPercent}%</span>
              <div
                className="tutorial-banner__progress-bar"
                role="progressbar"
                aria-valuenow={progress.progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="tutorial-banner__progress-fill"
                  style={{ width: `${progress.progressPercent}%` }}
                />
              </div>
              <button
                type="button"
                className="tutorial-banner__action"
                onClick={handleSkip}
                aria-label="Skip tutorial"
              >
                Skip
              </button>
              <button
                type="button"
                className="tutorial-banner__minimize"
                onClick={handleToggleMinimize}
                aria-label="Minimize tutorial banner"
              >
                <Icon name="ChevronUp" label="" />
              </button>
            </div>
          </div>
          <p className="tutorial-banner__instruction">{instruction}</p>
        </div>
      )}
    </div>
  );
}
