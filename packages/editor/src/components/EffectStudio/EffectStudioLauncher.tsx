import { Button } from '@varve/ui';
import { useEditor } from '../../context';
import { usePanelHost } from '../../workspace/PanelHostContext';

export interface EffectStudioLauncherProps {
  /** Small inspector launcher by default; callers may provide a custom label. */
  label?: string;
  className?: string;
}

/** Opens the controlled Studio dialog without routing the user through Appearance. */
export function EffectStudioLauncher({
  label = 'Open Effect Studio',
  className,
}: EffectStudioLauncherProps) {
  const { openEffectStudioDialog } = useEditor();
  const { isAuxiliary } = usePanelHost();
  const unavailableReason = 'Effect Studio opens in the main editor window.';

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={className}
        onClick={openEffectStudioDialog}
        disabled={isAuxiliary}
        aria-describedby={isAuxiliary ? 'effect-studio-dialog-unavailable' : undefined}
        data-testid="open-effect-studio"
      >
        {label}
      </Button>
      {isAuxiliary && (
        <span id="effect-studio-dialog-unavailable" className="varve-visually-hidden">
          {unavailableReason}
        </span>
      )}
    </>
  );
}
