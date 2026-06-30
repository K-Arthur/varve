import { Button, Dialog, Icon } from '@strata/ui';

export interface WelcomeDialogProps {
  open: boolean;
  onStartTour: () => void;
  onStartFromScratch: () => void;
  onClose: () => void;
}

export function WelcomeDialog({
  open,
  onStartTour,
  onStartFromScratch,
  onClose,
}: WelcomeDialogProps) {
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
          <button type="button" className="welcome-dialog__option" onClick={onStartFromScratch}>
            <Icon name="FilePlus" size="1.5em" />
            <span className="welcome-dialog__option-label">Start from scratch</span>
            <span className="welcome-dialog__option-desc">Begin with a blank canvas</span>
          </button>

          <button
            type="button"
            className="welcome-dialog__option"
            onClick={() => {
              document.querySelector<HTMLInputElement>('#file-open-input')?.click();
              onClose();
            }}
          >
            <Icon name="FolderOpen" size="1.5em" />
            <span className="welcome-dialog__option-label">Open recent document</span>
            <span className="welcome-dialog__option-desc">Continue where you left off</span>
          </button>

          <button type="button" className="welcome-dialog__option" onClick={onStartTour}>
            <Icon name="GraduationCap" size="1.5em" />
            <span className="welcome-dialog__option-label">Take a tour</span>
            <span className="welcome-dialog__option-desc">Learn the basics in 60 seconds</span>
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
