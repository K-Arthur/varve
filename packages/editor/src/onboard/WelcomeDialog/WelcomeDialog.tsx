import { Button, Dialog, Icon } from '@strata/ui';
import { useCallback } from 'react';

export interface WelcomeDialogProps {
  open: boolean;
  onStartTour: () => void;
  onStartTemplate: () => void;
  onStartBlank: () => void;
  onClose: () => void;
}

export function WelcomeDialog({
  open,
  onStartTour,
  onStartTemplate,
  onStartBlank,
  onClose,
}: WelcomeDialogProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <Dialog open={open} onClose={onClose} title="Welcome to Strata">
      <div className="welcome-dialog">
        <div className="welcome-dialog__logo">
          <Icon name="Layers" size="2.5em" label="Strata logo" />
        </div>
        <h2 className="welcome-dialog__heading">Welcome to Strata</h2>
        <p className="welcome-dialog__subtitle">
          A local-first, cross-platform design suite. Create shapes, export code, and collaborate in
          real time.
        </p>

        <div className="welcome-dialog__options">
          <button
            type="button"
            className="welcome-dialog__option"
            onClick={onStartTour}
            tabIndex={0}
          >
            <Icon name="GraduationCap" size="1.5em" />
            <span className="welcome-dialog__option-label">Take the tour</span>
            <span className="welcome-dialog__option-desc">Learn the basics in 60 seconds</span>
          </button>

          <button
            type="button"
            className="welcome-dialog__option"
            onClick={onStartTemplate}
            tabIndex={0}
          >
            <Icon name="LayoutTemplate" size="1.5em" />
            <span className="welcome-dialog__option-label">Start with a template</span>
            <span className="welcome-dialog__option-desc">Jump-start your project</span>
          </button>

          <button
            type="button"
            className="welcome-dialog__option"
            onClick={onStartBlank}
            tabIndex={0}
          >
            <Icon name="FilePlus" size="1.5em" />
            <span className="welcome-dialog__option-label">Blank canvas</span>
            <span className="welcome-dialog__option-desc">Begin with an empty design</span>
          </button>
        </div>

        <div className="welcome-dialog__actions">
          <Button variant="primary" size="md" onClick={onStartTour}>
            Get started
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
