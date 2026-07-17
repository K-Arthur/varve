import type { Fill, ManagedColor } from '@strata/scene';
import { useState } from 'react';
import { useEditor } from '../../../context';
import { checkFillContrast } from '../../../intelligence/wcagFix';

export interface ContrastIndicatorProps {
  fill: Fill;
  background?: ManagedColor | null;
  fontSize?: number;
  fontWeight?: number;
  fillIndex: number;
}

export function ContrastIndicator({
  fill,
  background,
  fontSize,
  fontWeight,
  fillIndex,
}: ContrastIndicatorProps) {
  const editor = useEditor();
  const [showPopover, setShowPopover] = useState(false);

  const fills = [fill];
  const result = checkFillContrast(fills, background ?? null, { fontSize, fontWeight });

  if (result.passes && !result.warning) return null;

  const dotClass = result.warning
    ? 'insp-contrast-dot insp-contrast-dot--warn'
    : result.passes
      ? 'insp-contrast-dot insp-contrast-dot--pass'
      : 'insp-contrast-dot insp-contrast-dot--fail';

  return (
    <>
      <button
        type="button"
        className={dotClass}
        onClick={() => setShowPopover(!showPopover)}
        aria-label={`Contrast: ${result.level} (${result.ratio.toFixed(1)}:1)`}
        title={`${result.level} — ${result.ratio.toFixed(1)}:1`}
      />
      {showPopover && (
        <div className="insp-contrast-popover" role="dialog" aria-label="Contrast details">
          <p className="insp-contrast-popover__ratio">Ratio: {result.ratio.toFixed(2)}:1</p>
          <p className="insp-contrast-popover__level">
            Level: {result.level}
            {fontSize != null && fontSize >= 24 ? ' (large text)' : ''}
          </p>
          {result.warning && <p className="insp-contrast-popover__warning">{result.warning}</p>}
          {result.autoFix && (
            <button
              type="button"
              className="insp-contrast-popover__fix-btn"
              onClick={() => {
                const fixed = result.autoFix!();
                editor.updateSelectedFillAt(fillIndex, { ...fill, color: fixed });
                editor.showToast?.({
                  message: `Contrast improved to ${result.ratio.toFixed(1)}:1`,
                });
                setShowPopover(false);
              }}
            >
              Auto-fix
            </button>
          )}
        </div>
      )}
    </>
  );
}
