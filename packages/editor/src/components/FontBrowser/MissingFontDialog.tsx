/**
 * MissingFontDialog — modal dialog for resolving missing fonts in a document.
 *
 * Shows each missing font with status, substitute candidates from FontResolver,
 * per-font apply, and a bulk "Replace All" action. Uses the modal dialog
 * pattern from APG with focus trapping.
 *
 * Research basis: Figma missing font dialog, InDesign missing font replacement.
 */
import type { FontSubstitute, MissingFontInfo } from '@varve/engine/font';
import { Select } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MissingFontRecoveryMatch } from './missingFontRecovery';
import { fontFaceLabel } from './missingFontRecovery';
import './MissingFontDialog.css';

export interface MissingFontDialogProps {
  missingFonts: MissingFontInfo[];
  recoveryMatches: ReadonlyMap<string, MissingFontRecoveryMatch>;
  downloadRestrictionMessage?: string;
  onReplace: (original: string, replacement: string) => void;
  onReplaceAll: (map: Map<string, string>) => void;
  onInstallFontsource: (missing: MissingFontInfo, match: MissingFontRecoveryMatch) => Promise<void>;
  onBrowseCatalog: (missing: MissingFontInfo) => void;
  onDismiss: () => void;
  onClose: () => void;
}

function bestSubstitute(substitutes: FontSubstitute[]): FontSubstitute | undefined {
  if (substitutes.length === 0) return undefined;
  return substitutes.reduce((best, cur) => (cur.confidence > best.confidence ? cur : best));
}

function initialSelections(
  missingFonts: readonly MissingFontInfo[],
  previous?: ReadonlyMap<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const missing of missingFonts) {
    const prior = previous?.get(missing.familyName);
    if (prior && missing.substitutes.some((candidate) => candidate.familyName === prior)) {
      map.set(missing.familyName, prior);
      continue;
    }
    const best = bestSubstitute(missing.substitutes);
    if (best) map.set(missing.familyName, best.familyName);
  }
  return map;
}

export function MissingFontDialog({
  missingFonts,
  recoveryMatches,
  downloadRestrictionMessage,
  onReplace,
  onReplaceAll,
  onInstallFontsource,
  onBrowseCatalog,
  onDismiss,
  onClose: _onClose,
}: MissingFontDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const [selections, setSelections] = useState<Map<string, string>>(() =>
    initialSelections(missingFonts),
  );
  const [installingFamily, setInstallingFamily] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    setSelections((previous) => initialSelections(missingFonts, previous));
  }, [missingFonts]);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    dialogRef.current?.focus();
    return () => {
      previousFocus.current?.focus();
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        _onClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable || focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [_onClose],
  );

  const handleApply = useCallback(
    (family: string) => {
      const replacement = selections.get(family);
      if (replacement) {
        onReplace(family, replacement);
      }
    },
    [selections, onReplace],
  );

  const handleReplaceAll = useCallback(() => {
    onReplaceAll(new Map(selections));
  }, [selections, onReplaceAll]);

  const handleSelectionChange = useCallback((family: string, replacement: string) => {
    setSelections((prev) => {
      const next = new Map(prev);
      if (replacement) next.set(family, replacement);
      else next.delete(family);
      return next;
    });
  }, []);

  const handleInstall = useCallback(
    async (missing: MissingFontInfo, match: MissingFontRecoveryMatch) => {
      setInstallingFamily(missing.familyName);
      setInstallError(null);
      try {
        await onInstallFontsource(missing, match);
      } catch (error) {
        setInstallError(
          error instanceof Error ? error.message : 'The matching font could not be installed.',
        );
      } finally {
        setInstallingFamily(null);
      }
    },
    [onInstallFontsource],
  );

  const allResolved = useMemo(() => {
    return missingFonts.every((mf) => Boolean(selections.get(mf.familyName)));
  }, [missingFonts, selections]);

  const statusLabels: Record<string, string> = {
    missing: 'Missing',
    corrupt: 'Corrupt',
    unsupported: 'Unsupported',
  };

  return (
    <div className="missing-font-dialog__overlay">
      <div
        ref={dialogRef}
        className="missing-font-dialog__content"
        role="dialog"
        aria-modal="true"
        aria-label="Missing Fonts"
        aria-describedby="missing-font-dialog-description missing-font-dialog-warning"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="missing-font-dialog__header">
          <h2 className="missing-font-dialog__title">
            Missing Fonts{' '}
            <span className="missing-font-dialog__count">({missingFonts.length})</span>
          </h2>
          <button
            type="button"
            className="missing-font-dialog__close-btn"
            onClick={_onClose}
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <p id="missing-font-dialog-description" className="missing-font-dialog__description">
          Varve found font families that are not available on this device. Install an exact
          Fontsource match when one is available, or choose a local replacement. Replacements apply
          to matching text nodes, rich-text runs, and shared text styles; the original family stays
          in the document font manifest.
        </p>

        <div className="missing-font-dialog__list">
          {missingFonts.map((mf) => {
            const substitute = selections.get(mf.familyName);
            const hasSubstitutes = mf.substitutes.length > 0;
            const recoveryMatch = recoveryMatches.get(mf.familyName);
            const installing = installingFamily === mf.familyName;

            return (
              <div key={mf.familyName} className="missing-font-dialog__item">
                <div className="missing-font-dialog__item-info">
                  <span className="missing-font-dialog__item-name">
                    <span className="missing-font-dialog__item-warning" aria-hidden="true">
                      &#9888;
                    </span>
                    {mf.familyName}
                  </span>
                  <span className="missing-font-dialog__item-status">
                    {statusLabels[mf.status] ?? mf.status}
                  </span>
                </div>

                <div className="missing-font-dialog__item-detail">
                  <span className="missing-font-dialog__item-nodes">
                    {mf.nodeIds.length > 0
                      ? `${mf.nodeIds.length} node${mf.nodeIds.length !== 1 ? 's' : ''}`
                      : 'Shared text style'}
                  </span>
                  <span className="missing-font-dialog__item-reference">
                    Original: {mf.originalReference}
                  </span>
                </div>

                <div className="missing-font-dialog__recovery">
                  <div className="missing-font-dialog__recovery-copy">
                    {recoveryMatch ? (
                      <>
                        <strong>
                          {recoveryMatch.matchedByAlias
                            ? `Catalog match: ${recoveryMatch.record.familyName}`
                            : 'Exact family available from Fontsource'}
                        </strong>
                        <span>
                          {fontFaceLabel(recoveryMatch)} · {recoveryMatch.record.license.name}
                          {!recoveryMatch.exactFace ? ' · closest available face' : ''}
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>No exact Fontsource family match</strong>
                        <span>Browse the local catalog for a reviewed alternative.</span>
                      </>
                    )}
                  </div>
                  {recoveryMatch && (
                    <button
                      type="button"
                      className="missing-font-dialog__install-btn"
                      onClick={() => void handleInstall(mf, recoveryMatch)}
                      disabled={installingFamily !== null || Boolean(downloadRestrictionMessage)}
                      aria-label={`Install ${recoveryMatch.record.familyName} ${fontFaceLabel(recoveryMatch)}`}
                    >
                      {installing
                        ? 'Installing…'
                        : recoveryMatch.exactFace
                          ? 'Install exact face'
                          : 'Install closest face'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="missing-font-dialog__browse-btn"
                    onClick={() => onBrowseCatalog(mf)}
                    disabled={installingFamily !== null}
                  >
                    Browse fonts
                  </button>
                </div>

                {recoveryMatch && downloadRestrictionMessage && (
                  <p className="missing-font-dialog__restriction">{downloadRestrictionMessage}</p>
                )}

                <div className="missing-font-dialog__item-substitute">
                  <span className="missing-font-dialog__substitute-label">Replace with:</span>
                  <Select
                    label={`Substitute for ${mf.familyName}`}
                    value={substitute ?? ''}
                    options={[
                      { value: '', label: 'Choose a replacement' },
                      ...mf.substitutes.map((sub) => ({
                        value: sub.familyName,
                        label: `${sub.familyName} (${sub.matchQuality})`,
                      })),
                    ]}
                    disabled={!hasSubstitutes}
                    onChange={(v) => handleSelectionChange(mf.familyName, v)}
                  />
                  <button
                    type="button"
                    className="missing-font-dialog__apply-btn"
                    onClick={() => handleApply(mf.familyName)}
                    disabled={!substitute || installingFamily !== null}
                  >
                    Apply
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {installError && (
          <p className="missing-font-dialog__install-error" role="alert">
            {installError}
          </p>
        )}

        <p id="missing-font-dialog-warning" className="missing-font-dialog__warning">
          Text layout may change after replacement. Review wrapping and export before delivery.
        </p>

        <div className="missing-font-dialog__actions">
          <button
            type="button"
            className="missing-font-dialog__btn missing-font-dialog__btn--secondary"
            onClick={onDismiss}
          >
            Dismiss
          </button>
          <button
            type="button"
            className="missing-font-dialog__btn missing-font-dialog__btn--primary"
            onClick={handleReplaceAll}
            disabled={!allResolved || installingFamily !== null}
          >
            Replace All
          </button>
        </div>
      </div>
    </div>
  );
}
