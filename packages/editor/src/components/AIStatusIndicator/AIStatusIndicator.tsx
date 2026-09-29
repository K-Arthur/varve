/**
 * AIStatusIndicator — transient on-device inference state, nothing else.
 *
 * This chip deliberately renders **only while inference is running**. The idle
 * state it used to occupy — a permanent `On-Device AI` pill claiming "Private &
 * 100% local (no cloud transmission)" — stated a fact that is always true of
 * Varve, so it never carried information, and repeated a promise the website
 * already makes in five places. A permanent chip whose message cannot change
 * is decorative chrome, which `docs/architecture/workspace-system.md` bans
 * outright; it also fails the same bar Figma's UI3 was criticized for in
 * `docs/audits/bottom-bar-review-2026-09-29.md` — permanent chrome that
 * "provides nothing that isn't already available". The privacy claim belongs
 * where a decision is made: the AIPanel header, the AI command tooltips, and
 * Settings, all of which already state it.
 *
 * What is genuinely needed is the other half: background removal, generative
 * edit, content-aware fill and upscaling all take seconds, and
 * `InferenceAdmission` is the only cross-surface signal that a lease is
 * active or queued (see `packages/engine/src/inference/admission.ts`). A
 * per-surface pending flag only reflects that one caller. The status bar is
 * where in-progress operations belong — the same split Blender makes between
 * transient operation messages (status bar) and steady state (editor header).
 *
 * The live region is always mounted even though the chip is not: a screen
 * reader frequently does not announce a live region that is inserted together
 * with its text. This mirrors `SaveStatusIndicator`, which keeps its own
 * permanent `sr-only` region in the same bar for the same reason.
 *
 * Because there is no longer anything persistent to configure, this is NOT a
 * `StatusSectionId` — the `aiStatus` id was retired with the idle chip.
 */

import { getInferenceAdmission } from '@varve/engine';
import { Tooltip } from '@varve/ui';
import { useSyncExternalStore } from 'react';
import { useEditor } from '../../context';
import './AIStatusIndicator.css';

export interface AIStatusIndicatorProps {
  className?: string;
}

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
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {isBusy ? 'AI processing locally' : ''}
      </span>
      {isBusy && (
        <Tooltip label="On-device neural engine processing…">
          <div className={`ai-status-indicator ai-status-indicator--busy ${className}`}>
            <span className="ai-status-indicator__dot" aria-hidden="true" />
            <span className="ai-status-indicator__label">Processing</span>
          </div>
        </Tooltip>
      )}
    </>
  );
}
