import { Button, Dialog, Icon } from '@varve/ui';

export interface WelcomeDialogProps {
  open: boolean;
  onStartTour: () => void;
  onStartBlank: () => void;
  onStartTemplate: () => void;
  onStartTutorial?: () => void;
  onClose: () => void;
}

export function WelcomeDialog({
  open,
  onStartTour,
  onStartBlank,
  onStartTemplate,
  onStartTutorial,
  onClose,
}: WelcomeDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Welcome to Varve">
      <div className="welcome-dialog">
        <div className="welcome-dialog__logo">
          <Icon name="Layers" size="2.5em" label="Varve logo" />
        </div>
        <h2 className="welcome-dialog__heading">Welcome to Varve</h2>
        <p className="welcome-dialog__subtitle">
          A local-first design application for vector, layout, typography, motion, prototyping,
          and print. Your work stays on your machine.
        </p>

        <div className="welcome-dialog__options">
          <button
            type="button"
            className="welcome-dialog__option"
            onClick={onStartTutorial ?? onStartTour}
          >
            <Icon name="GraduationCap" size="1.5em" />
            <span className="welcome-dialog__option-label">Take the tour</span>
            <span className="welcome-dialog__option-desc">Learn the basics in 60 seconds</span>
          </button>

          <button type="button" className="welcome-dialog__option" onClick={onStartTemplate}>
            <Icon name="LayoutTemplate" size="1.5em" />
            <span className="welcome-dialog__option-label">Start with a template</span>
            <span className="welcome-dialog__option-desc">Jump-start your project</span>
          </button>

          <button type="button" className="welcome-dialog__option" onClick={onStartBlank}>
            <Icon name="FilePlus" size="1.5em" />
            <span className="welcome-dialog__option-label">Blank canvas</span>
            <span className="welcome-dialog__option-desc">Begin with an empty design</span>
          </button>
        </div>

        <div className="welcome-dialog__actions">
          <Button variant="primary" size="md" onClick={onStartTutorial ?? onStartTour}>
            Get started
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
