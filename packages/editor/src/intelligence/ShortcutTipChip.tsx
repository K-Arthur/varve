import { Icon } from '@strata/ui';
import type { ShortcutRecommendation } from './shortcutRecommender';

interface ShortcutTipChipProps {
  tip: ShortcutRecommendation;
  onDismiss: () => void;
  onOpenPalette: (shortcutId: string) => void;
}

export function ShortcutTipChip({ tip, onDismiss, onOpenPalette }: ShortcutTipChipProps) {
  return (
    <span className="editor-status__tip-chip" role="status" aria-live="polite" title={tip.message}>
      <button
        type="button"
        className="editor-status__tip-chip-body"
        onClick={() => onOpenPalette(tip.shortcutId)}
        aria-label={`${tip.message} — click to open keyboard shortcuts`}
      >
        {tip.message}
      </button>
      <button
        type="button"
        className="editor-status__tip-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss tip"
      >
        <Icon name="X" size={10} />
      </button>
    </span>
  );
}
