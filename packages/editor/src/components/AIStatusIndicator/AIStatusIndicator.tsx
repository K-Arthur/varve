/**
 * AIStatusIndicator — non-blocking chrome chip showing local on-device ML status.
 *
 * Research basis: Varve is local-first; inference (background removal, upscale, vectorize)
 * runs on-device via WebGPU / ONNX / native engine without sending user pixels to cloud servers.
 *
 * Displays a quiet status chip in the editor chrome with signature electric teal
 * (--color-signature-ai) indicator.
 */

import { getInferenceAdmission } from '@varve/engine';
import { Tooltip } from '@varve/ui';
import { useSyncExternalStore } from 'react';
import { useEditor } from '../../context';
import './AIStatusIndicator.css';

export interface AIStatusIndicatorProps {
  className?: string;
}

/**
 * Background removal, generative edit, and the shared model-worker host all
 * acquire a lease from the same `InferenceAdmission` queue (see
 * packages/engine/src/inference/admission.ts). Reading its snapshot is the
 * one real cross-editor "AI is running" signal — a per-surface local flag
 * (e.g. the quick bar's own pending state) only reflects that one caller.
 */
function subscribeAdmission(onChange: () => void): () => void {
  return getInferenceAdmission().subscribe(onChange);
}

function getAdmissionBusySnapshot(): boolean {
  const snapshot = getInferenceAdmission().getSnapshot();
  return snapshot.active > 0 || snapshot.pending > 0;
}

export function AIStatusIndicator({ className = '' }: AIStatusIndicatorProps) {
  const { state } = useEditor();
  const admissionBusy = useSyncExternalStore(subscribeAdmission, getAdmissionBusySnapshot);
  const isBusy = admissionBusy || state.upscaleDialogOpen;

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
