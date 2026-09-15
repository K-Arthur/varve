/**
 * AIStatusIndicator — non-blocking chrome chip showing local on-device ML status.
 *
 * Research basis: Varve is local-first; inference (background removal, upscale, vectorize)
 * runs on-device via WebGPU / ONNX / native engine without sending user pixels to cloud servers.
 *
 * Displays a quiet status chip in the editor chrome with signature electric teal
 * (--color-signature-ai) indicator.
 */

import { Tooltip } from '@varve/ui';
import { useEditor } from '../../context';
import './AIStatusIndicator.css';

export interface AIStatusIndicatorProps {
  className?: string;
}

export function AIStatusIndicator({ className = '' }: AIStatusIndicatorProps) {
  const { state } = useEditor();
  const isBusy = Boolean(state.bgRemovalPending || state.upscaleDialogOpen);

  return (
    <Tooltip
      label={
        isBusy
          ? 'On-device neural engine processing…'
          : 'On-device neural engine: Private & 100% local (no cloud transmission)'
      }
    >
      <div
        className={`ai-status-indicator${isBusy ? ' ai-status-indicator--busy' : ''} ${className}`}
        role="status"
        aria-live="polite"
        aria-label={isBusy ? 'AI Processing locally' : 'Local neural engine ready'}
      >
        <span className="ai-status-indicator__dot" aria-hidden="true" />
        <span className="ai-status-indicator__label">{isBusy ? 'Processing' : 'On-Device AI'}</span>
      </div>
    </Tooltip>
  );
}
