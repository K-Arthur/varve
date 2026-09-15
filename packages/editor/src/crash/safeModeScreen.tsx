/**
 * Safe-mode recovery screen (Phase 8).
 *
 * Shown when repeated startup failures are detected. Visible, reversible,
 * and it never erases user settings, files, models, fonts, or autosaves —
 * it only toggles startup behavior. Crash-reporting consent remains
 * respected in safe mode (the crash dialog is independent).
 */

import type { SafeModeOptions } from '@varve/crash';
import { useCallback, useEffect, useRef } from 'react';

export interface SafeModeScreenProps {
  appVersion: string;
  onExit: () => void;
  onContinue: () => void;
  onToggleOption: (option: keyof SafeModeOptions, value: boolean) => void;
}

const OPTION_LABELS: Array<{ id: keyof SafeModeOptions; label: string; description: string }> = [
  {
    id: 'disableGpu',
    label: 'Disable GPU acceleration',
    description: 'Use software rendering while in safe mode. Your settings are unchanged.',
  },
  {
    id: 'skipLastDocument',
    label: 'Skip reopening the last document',
    description: 'Start without the most recent file. The file is not deleted.',
  },
  {
    id: 'skipWorkspaceRestore',
    label: 'Skip restoring the last workspace',
    description: 'Start with the default panel layout. Your layout is not deleted.',
  },
  {
    id: 'disableModels',
    label: 'Disable downloaded models',
    description: 'Pause AI models that may be causing startup problems. Models stay installed.',
  },
  {
    id: 'disableExtensions',
    label: 'Disable third-party extensions',
    description: 'Load only built-in features while in safe mode.',
  },
  {
    id: 'resetWindowLayout',
    label: 'Reset window layout',
    description: 'Restore the default window arrangement. Your documents are untouched.',
  },
  {
    id: 'resetCaches',
    label: 'Reset only affected caches',
    description: 'Clear temporary render and font caches. No documents, settings, or autosaves.',
  },
];

export function SafeModeScreen({
  appVersion,
  onExit,
  onContinue,
  onToggleOption,
}: SafeModeScreenProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // No Escape-to-continue: exiting safe mode must be deliberate.
    e.stopPropagation();
  }, []);

  return (
    <div
      ref={ref}
      className="safe-mode-screen"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="safe-mode-title"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="safe-mode-screen__card">
        <div className="safe-mode-screen__badge">Safe mode</div>
        <h1 id="safe-mode-title" className="safe-mode-screen__title">
          Varve had trouble starting
        </h1>
        <p className="safe-mode-screen__intro">
          Varve closed unexpectedly several times in a row. Safe mode starts with only the
          essentials so you can recover your work. Nothing is deleted — you can turn everything back
          on when you leave safe mode.
        </p>
        <p className="safe-mode-screen__version">Varve {appVersion}</p>

        <fieldset className="safe-mode-screen__options">
          <legend className="safe-mode-screen__legend">
            Choose what to disable while in safe mode
          </legend>
          {OPTION_LABELS.map((option) => (
            <label key={option.id} className="safe-mode-screen__option">
              <input
                type="checkbox"
                defaultChecked={option.id !== 'resetWindowLayout' && option.id !== 'resetCaches'}
                onChange={(e) => onToggleOption(option.id, e.target.checked)}
              />
              <span className="safe-mode-screen__option-text">
                <span className="safe-mode-screen__option-label">{option.label}</span>
                <span className="safe-mode-screen__option-desc">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="safe-mode-screen__actions">
          <button
            type="button"
            className="safe-mode-screen__btn safe-mode-screen__btn--primary"
            onClick={onContinue}
          >
            Start Varve in safe mode
          </button>
          <button
            type="button"
            className="safe-mode-screen__btn safe-mode-screen__btn--secondary"
            onClick={onExit}
          >
            Continue normal startup
          </button>
        </div>
        <p className="safe-mode-screen__note">
          Safe mode is temporary. You can leave it at any time from Privacy and diagnostics
          settings, or by choosing &quot;Continue normal startup&quot;.
        </p>
      </div>
    </div>
  );
}
