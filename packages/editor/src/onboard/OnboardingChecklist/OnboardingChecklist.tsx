import { Icon } from '@strata/ui';
import { useEffect, useRef } from 'react';
import './OnboardingChecklist.css';

export interface OnboardingChecklistProps {
  open: boolean;
  onClose: () => void;
  progress: string[];
  onItemClick: (itemId: string) => void;
  onDismiss: () => void;
}

interface ChecklistItem {
  id: string;
  label: string;
}

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: 'shape', label: 'Add your first shape' },
  { id: 'color', label: "Change a shape's color" },
  { id: 'text', label: 'Add some text' },
  { id: 'group', label: 'Group your shapes' },
  { id: 'export', label: 'Export your design' },
];

function useAutoDismiss(allDone: boolean, onClose: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (allDone) {
      timerRef.current = setTimeout(() => {
        onClose();
      }, 3000);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [allDone, onClose]);
}

export function OnboardingChecklist({
  open,
  onClose,
  progress,
  onItemClick,
  onDismiss,
}: OnboardingChecklistProps) {
  const completedCount = CHECKLIST_ITEMS.filter((item) => progress.includes(item.id)).length;
  const totalCount = CHECKLIST_ITEMS.length;
  const allDone = completedCount === totalCount;

  useAutoDismiss(allDone, onClose);

  if (!open) return null;

  if (allDone) {
    return (
      <section
        className="onboarding-checklist onboarding-checklist--celebration"
        aria-label="Getting started checklist"
      >
        <div className="onboarding-checklist__celebration">
          <Icon name="Check" size="1.5em" label="Complete" />
          <p className="onboarding-checklist__celebration-text">All done!</p>
          <p className="onboarding-checklist__celebration-sub">You have completed all the steps</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`onboarding-checklist ${open ? 'onboarding-checklist--open' : ''}`}
      aria-label="Getting started checklist"
    >
      <div className="onboarding-checklist__header">
        <span className="onboarding-checklist__title">Getting started</span>
        <span className="onboarding-checklist__progress" aria-live="polite">
          {completedCount} / {totalCount}
        </span>
      </div>

      <div
        className="onboarding-checklist__progress-bar"
        role="progressbar"
        aria-valuenow={completedCount}
        aria-valuemin={0}
        aria-valuemax={totalCount}
      >
        <div
          className="onboarding-checklist__progress-fill"
          style={{ width: `${(completedCount / totalCount) * 100}%` }}
        />
      </div>

      <ul className="onboarding-checklist__items">
        {CHECKLIST_ITEMS.map((item) => {
          const checked = progress.includes(item.id);
          return (
            <li key={item.id} className="onboarding-checklist__item">
              {checked ? (
                <span className="onboarding-checklist__check-icon">
                  <Icon name="Check" size="1em" label="Done" />
                </span>
              ) : (
                <span className="onboarding-checklist__circle" />
              )}
              <button
                type="button"
                className={`onboarding-checklist__label ${checked ? 'onboarding-checklist__label--done' : ''}`}
                onClick={() => {
                  if (!checked) onItemClick(item.id);
                }}
                tabIndex={0}
                aria-disabled={checked}
              >
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="onboarding-checklist__footer">
        <button
          type="button"
          className="onboarding-checklist__dismiss"
          onClick={onDismiss}
          tabIndex={0}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
