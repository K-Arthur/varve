/**
 * PrintSettingsPanel — press/print controls for PDF/X export jobs (Strata
 * export rebuild, M9).
 *
 * Capability-honest by construction: every control maps to an option the native
 * print pipeline actually consumes (`PdfXOptions` in the desktop command:
 * bleed, crop marks, registration marks, color bars, outline text, DPI floor).
 * The ICC profile is shown as a read-only value because the CMYK conversion
 * currently uses the bundled Fogra39 profile regardless of the option string —
 * exposing a selector the encoder would ignore would violate the capability
 * contract, so it is surfaced as an explanatory note instead.
 *
 * The panel is fully controlled (`value`/`onChange`) and never mutates the
 * document.
 */

import type { PrintOptions } from '@varve/scene';
import { Checkbox, Icon } from '@varve/ui';
import { useId } from 'react';

import './PrintSettingsPanel.css';

export interface PrintSettingsPanelProps {
  value: PrintOptions;
  onChange: (next: PrintOptions) => void;
  /** PDF/X standard being configured; affects the default mark set. */
  standard: 'pdf-x1a' | 'pdf-x4';
  /**
   * The document's canonical bleed in millimetres (resolved from
   * printGeometry). Shown as a reference so the relationship is explicit:
   * the field is an export-job override of the document bleed, which is
   * what the canvas preview and trim geometry use.
   */
  documentBleedMm?: number;
}

export function PrintSettingsPanel({
  value,
  onChange,
  standard,
  documentBleedMm,
}: PrintSettingsPanelProps) {
  const bleedId = useId();
  const dpiId = useId();

  const setBleed = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    const next = Number.isFinite(parsed) ? Math.max(0, Math.min(25, parsed)) : 0;
    onChange({ ...value, bleedMm: next });
  };

  const setDpi = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    const next = Number.isFinite(parsed) ? Math.max(72, Math.min(600, parsed)) : 300;
    onChange({ ...value, enforceDpi: next });
  };

  return (
    <section className="print-settings" aria-label="Print settings">
      <h4 className="print-settings__title">
        <Icon name="Printer" size={14} label={undefined} />
        Press / print settings ({standard === 'pdf-x1a' ? 'PDF/X-1a' : 'PDF/X-4'})
      </h4>

      <div className="print-settings__grid">
        <div className="print-settings__field">
          <label className="print-settings__label" htmlFor={bleedId}>
            Bleed (mm)
          </label>
          <input
            id={bleedId}
            type="number"
            className="print-settings__input"
            min={0}
            max={25}
            step={0.5}
            value={value.bleedMm ?? 3}
            onChange={(e) => setBleed(e.target.value)}
            aria-label="Bleed in millimetres"
          />
        </div>

        <div className="print-settings__field">
          <label className="print-settings__label" htmlFor={dpiId}>
            Resolution floor (dpi)
          </label>
          <input
            id={dpiId}
            type="number"
            className="print-settings__input"
            min={72}
            max={600}
            step={50}
            value={value.enforceDpi ?? 300}
            onChange={(e) => setDpi(e.target.value)}
            aria-label="Minimum effective image resolution in DPI"
          />
        </div>
      </div>

      <div className="print-settings__marks">
        <Checkbox
          label="Crop marks"
          checked={value.includeCropMarks ?? true}
          onChange={(e) => onChange({ ...value, includeCropMarks: e.target.checked })}
        />
        <Checkbox
          label="Registration marks"
          checked={value.includeRegistrationMarks ?? standard === 'pdf-x1a'}
          onChange={(e) => onChange({ ...value, includeRegistrationMarks: e.target.checked })}
        />
        <Checkbox
          label="Color bars"
          checked={value.includeColorBars ?? standard === 'pdf-x1a'}
          onChange={(e) => onChange({ ...value, includeColorBars: e.target.checked })}
        />
        <Checkbox
          label="Convert text to outlines"
          checked={value.outlineText ?? false}
          onChange={(e) => onChange({ ...value, outlineText: e.target.checked })}
        />
      </div>

      <p className="print-settings__note">
        {documentBleedMm != null && documentBleedMm > 0 ? (
          <>
            Document bleed: {documentBleedMm.toFixed(2)} mm — this field overrides it for this
            export only.
          </>
        ) : (
          'This document has no bleed configured; the field above applies to this export only.'
        )}{' '}
        CMYK conversion uses the bundled Fogra39 profile. The resolution floor is a preflight
        threshold for embedded raster content, not an encoder resize.
      </p>
    </section>
  );
}
