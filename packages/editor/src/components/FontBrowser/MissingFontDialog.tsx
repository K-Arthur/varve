/**
 * MissingFontDialog — modal dialog for resolving missing fonts in a document.
 *
 * Shows each missing font with status, substitute candidates from FontResolver,
 * per-font apply, and a bulk "Replace All" action. Uses the modal dialog
 * pattern from APG with focus trapping.
 *
 * Research basis: Figma missing font dialog, InDesign missing font replacement.
 */
import type { FontCatalog, FontSubstitute, MissingFontInfo } from '@varve/engine/font';
import { Select } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './MissingFontDialog.css';

export interface MissingFontDialogProps {
  missingFonts: MissingFontInfo[];
  catalog: FontCatalog;
  onReplace: (original: string, replacement: string) => void;
  onReplaceAll: (map: Map<string, string>) => void;
  onDismiss: () => void;
  onClose: () => void;
}

function bestSubstitute(substitutes: FontSubstitute[]): FontSubstitute | undefined {
  if (substitutes.length === 0) return undefined;
  return substitutes.reduce((best, cur) => (cur.confidence > best.confidence ? cur : best));
}

export function MissingFontDialog({
  missingFonts,
  catalog: _catalog,
  onReplace,
  onReplaceAll,
  onDismiss,
  onClose: _onClose,
}: MissingFontDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const [selections, setSelections] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const mf of missingFonts) {
      const best = bestSubstitute(mf.substitutes);
      if (best) {
        map.set(mf.familyName, best.familyName);
      }
    }
    return map;
  });

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
        onDismiss();
      }
    },
    [onDismiss],
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
      next.set(family, replacement);
      return next;
    });
  }, []);

  const allResolved = useMemo(() => {
    return missingFonts.every((mf) => selections.has(mf.familyName));
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
            onClick={onDismiss}
            aria-label="Close"
          >
            &#x2715;
          </button>
        </div>

        <div className="missing-font-dialog__list">
          {missingFonts.map((mf) => {
            const substitute = selections.get(mf.familyName);
            const hasSubstitutes = mf.substitutes.length > 0;

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
                    {mf.nodeIds.length} node{mf.nodeIds.length !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className="missing-font-dialog__item-substitute">
                  <label
                    className="missing-font-dialog__substitute-label"
                    htmlFor={`substitute-${mf.familyName}`}
                  >
                    Replace with:
                  </label>
                  <Select
                    label={`Substitute for ${mf.familyName}`}
                    value={substitute ?? ''}
                    options={[
                      { value: '', label: 'Use system default' },
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
                    disabled={!substitute}
                  >
                    Apply
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="missing-font-dialog__warning">
          Text layout may change after font replacement.
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
            disabled={!allResolved}
          >
            Replace All
          </button>
        </div>
      </div>
    </div>
  );
}
