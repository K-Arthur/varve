/**
 * Export settings tab — configure default export format, scale, ICC profile,
 * bleed, outline text, filename template, and color profile.
 */

import type { ExportFormat, RenderingIntent } from '@varve/scene';
import { NumberInput, Select } from '@varve/ui';
import { useState } from 'react';
import { useSettings } from './SettingsContext';

import './ExportSettingsTab.css';

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'svg', label: 'SVG' },
  { value: 'pdf-screen', label: 'PDF (Screen)' },
  { value: 'pdf-x1a', label: 'PDF/X-1a' },
  { value: 'pdf-x4', label: 'PDF/X-4' },
  { value: 'react-tailwind', label: 'React + Tailwind' },
  { value: 'react-cssmodules', label: 'React + CSS Modules' },
  { value: 'flutter', label: 'Flutter' },
  { value: 'swiftui', label: 'SwiftUI' },
  { value: 'svg-component', label: 'SVG Component' },
];

const SCALE_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '1x' },
  { value: '2', label: '2x' },
  { value: '3', label: '3x' },
  { value: 'custom', label: 'Custom' },
];

const COLOR_SPACE_OPTIONS: { value: string; label: string }[] = [
  { value: 'srgb', label: 'sRGB' },
  { value: 'display-p3', label: 'Display P3' },
  { value: 'adobe-rgb', label: 'Adobe RGB (1998)' },
  { value: 'pro-photo', label: 'ProPhoto RGB' },
];

const ICC_OPTIONS: { value: string; label: string }[] = [
  { value: 'FOGRA39', label: 'FOGRA39 (ISO Coated)' },
  { value: 'GRACoL2006', label: 'GRACoL 2006' },
  { value: 'SWOP', label: 'SWOP (US Web Coated)' },
];

const INTENT_OPTIONS: { value: RenderingIntent; label: string }[] = [
  { value: 'perceptual', label: 'Perceptual' },
  { value: 'relative', label: 'Relative Colorimetric' },
  { value: 'absolute', label: 'Absolute Colorimetric' },
  { value: 'saturation', label: 'Saturation' },
];

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-field-row">
      <span className="settings-field-row__label">{label}</span>
      <div className="settings-field-row__control">{children}</div>
    </div>
  );
}

export function ExportSettingsTab() {
  const { settings, updateSection } = useSettings();
  const [customScale, setCustomScale] = useState('');

  const scaleValue =
    settings.export.defaultScale.type === 'factor'
      ? String(settings.export.defaultScale.value)
      : 'custom';

  function updateExport(patch: Partial<typeof settings.export>) {
    updateSection('export', patch as Record<string, unknown>);
  }

  function handleScaleSelect(value: string) {
    if (value === 'custom') {
      setCustomScale(
        String(
          settings.export.defaultScale.type === 'factor' ? settings.export.defaultScale.value : 2,
        ),
      );
    } else {
      updateExport({ defaultScale: { type: 'factor', value: Number(value) } });
    }
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Export</h3>

      <FieldRow label="Default format">
        <Select
          options={FORMAT_OPTIONS}
          value={settings.export.defaultFormat}
          onChange={(v) => updateExport({ defaultFormat: v as ExportFormat })}
          label="Default format"
        />
      </FieldRow>

      <FieldRow label="Default scale">
        <div className="export-settings__scale-row">
          <Select
            options={SCALE_OPTIONS}
            value={scaleValue}
            onChange={handleScaleSelect}
            label="Default scale"
          />
          {scaleValue === 'custom' && (
            <input
              type="number"
              className="export-settings__custom-scale"
              value={customScale}
              onChange={(e) => {
                setCustomScale(e.target.value);
                const v = Number.parseFloat(e.target.value);
                if (!Number.isNaN(v) && v > 0) {
                  updateExport({ defaultScale: { type: 'factor', value: v } });
                }
              }}
              min={0.1}
              max={10}
              step={0.5}
              aria-label="Custom scale"
            />
          )}
        </div>
      </FieldRow>

      <FieldRow label="Color space">
        <Select
          options={COLOR_SPACE_OPTIONS}
          value={settings.export.defaultColorProfile}
          onChange={(v) =>
            updateExport({
              defaultColorProfile: v as 'srgb' | 'display-p3' | 'adobe-rgb' | 'pro-photo',
            })
          }
          label="Default color space"
        />
        <p className="export-settings__hint">
          PNG/JPEG outputs are converted to the chosen space and tagged with an embedded ICC
          profile. WebP cannot embed profiles on this pipeline and stays sRGB (disclosed per
          export).
        </p>
      </FieldRow>

      <FieldRow label="ICC profile">
        <Select
          options={ICC_OPTIONS}
          value={settings.export.defaultIccProfile}
          onChange={(v) => updateExport({ defaultIccProfile: v })}
          label="ICC profile"
        />
      </FieldRow>

      <FieldRow label="Bleed (mm)">
        <NumberInput
          value={settings.export.defaultBleedMm}
          min={0}
          max={50}
          step={1}
          onChange={(v) => updateExport({ defaultBleedMm: v })}
          label="Bleed"
        />
      </FieldRow>

      <FieldRow label="Outline text">
        <label className="settings-checkbox-row">
          <input
            type="checkbox"
            checked={settings.export.defaultOutlineText}
            onChange={(e) => updateExport({ defaultOutlineText: e.target.checked })}
          />
          <span>Convert text to outlines on export</span>
        </label>
      </FieldRow>

      <FieldRow label="Filename template">
        <input
          type="text"
          className="export-settings__template"
          value={settings.export.defaultFilenameTemplate}
          onChange={(e) => updateExport({ defaultFilenameTemplate: e.target.value })}
          aria-label="Filename template"
        />
        <div className="export-settings__hints">
          <code>{'{name}'}</code> <code>{'{suffix}'}</code> <code>{'{ext}'}</code>
        </div>
      </FieldRow>

      <FieldRow label="Rendering intent">
        <Select
          options={INTENT_OPTIONS}
          value={settings.export.defaultRenderingIntent}
          onChange={(v) => updateExport({ defaultRenderingIntent: v as RenderingIntent })}
          label="Rendering intent"
        />
      </FieldRow>
    </div>
  );
}
