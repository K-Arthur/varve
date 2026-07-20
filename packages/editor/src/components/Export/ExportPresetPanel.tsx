/**
 * Export preset panel — per-node export configuration.
 *
 * Appears in the inspector's Export tab when a node is selected.
 * Each node can have multiple export presets (PNG@1x, PNG@2x, SVG, etc.).
 *
 * Follows the same pattern as other inspector sections (Section, control rows).
 */

import type { ExportFormat, ExportPreset, SceneNode } from '@strata/scene';
import { Select } from '@strata/ui';
import { useState } from 'react';

import './export-preset-panel.css';

interface ExportPresetPanelProps {
  node: SceneNode;
  onAddPreset: (preset: ExportPreset) => void;
  onUpdatePreset: (preset: ExportPreset) => void;
  onRemovePreset: (presetId: string) => void;
}

function createDefaultPreset(format: ExportFormat, index: number): ExportPreset {
  const scaleSettings = {
    scale: {
      type: 'factor' as const,
      value: format === 'svg' || format.startsWith('react') ? 1 : 2,
    },
  };
  return {
    id: `preset-${Date.now()}-${index}`,
    format,
    ...scaleSettings,
    suffix: format === 'svg' || format.startsWith('react') ? '' : '@2x',
    enabled: true,
  };
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  png: 'PNG',
  jpg: 'JPEG',
  webp: 'WebP',
  avif: 'AVIF',
  svg: 'SVG',
  'pdf-screen': 'PDF (Screen)',
  'pdf-x1a': 'PDF/X-1a',
  'pdf-x4': 'PDF/X-4',
  'react-tailwind': 'React + Tailwind',
  'react-cssmodules': 'React + CSS Modules',
  flutter: 'Flutter',
  swiftui: 'SwiftUI',
  'svg-component': 'SVG Component',
};

export function ExportPresetPanel({
  node,
  onAddPreset,
  onUpdatePreset,
  onRemovePreset,
}: ExportPresetPanelProps) {
  const presets = node.presets ?? [];
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('png');

  function handleAdd() {
    onAddPreset(createDefaultPreset(selectedFormat, presets.length));
  }

  return (
    <section className="export-preset-panel" aria-label="Export presets">
      <Section title="Export">
        {presets.length === 0 && (
          <div className="export-preset-panel__empty">No export presets for this node.</div>
        )}

        {presets.map((preset) => (
          <PresetRow
            key={preset.id}
            preset={preset}
            nodeName={node.name}
            onUpdate={(p) => onUpdatePreset(p)}
            onRemove={() => onRemovePreset(preset.id)}
          />
        ))}

        <div className="export-preset-panel__add-row">
          <Select
            label="Format"
            value={selectedFormat}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpg', label: 'JPEG' },
              { value: 'webp', label: 'WebP' },
              { value: 'avif', label: 'AVIF' },
              { value: 'svg', label: 'SVG' },
              { value: 'pdf-screen', label: 'PDF (Screen)' },
              { value: 'pdf-x1a', label: 'PDF/X-1a' },
              { value: 'pdf-x4', label: 'PDF/X-4' },
              { value: 'react-tailwind', label: 'React + Tailwind' },
              { value: 'react-cssmodules', label: 'React + CSS Modules' },
              { value: 'flutter', label: 'Flutter' },
              { value: 'swiftui', label: 'SwiftUI' },
              { value: 'svg-component', label: 'SVG Component' },
            ]}
            onChange={(v) => setSelectedFormat(v as ExportFormat)}
          />
          <button
            type="button"
            onClick={handleAdd}
            aria-label="Add preset"
            className="export-preset-panel__add-btn"
          >
            + Add
          </button>
        </div>
      </Section>
    </section>
  );
}

interface PresetRowProps {
  preset: ExportPreset;
  nodeName: string;
  onUpdate: (preset: ExportPreset) => void;
  onRemove: () => void;
}

export function PresetRow({ preset, nodeName, onUpdate, onRemove }: PresetRowProps) {
  const scaleLabel =
    preset.scale.type === 'factor' ? `${preset.scale.value}x` : `${preset.scale.pixels}px`;
  const formatLabel = FORMAT_LABELS[preset.format] ?? preset.format;

  return (
    <div className="export-preset-row">
      <label className="export-preset-row__checkbox">
        <input
          type="checkbox"
          checked={preset.enabled}
          onChange={(e) => onUpdate({ ...preset, enabled: e.target.checked })}
          aria-label={`Enable ${formatLabel} preset`}
        />
      </label>
      <div className="export-preset-row__label">
        <div className="export-preset-row__name">
          {nodeName}
          {preset.suffix}.{preset.format}
        </div>
        <div className="export-preset-row__details">
          {formatLabel}, {scaleLabel}
        </div>
      </div>
      <input
        value={preset.suffix}
        onChange={(e) => onUpdate({ ...preset, suffix: e.target.value })}
        aria-label="Filename suffix"
        className="export-preset-row__suffix"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${formatLabel} preset`}
        className="export-preset-row__remove"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path
            d="M1 1l8 8M9 1l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="inspector-section">
      <h3 className="inspector-section__title">{title}</h3>
      <div className="inspector-section__body">{children}</div>
    </div>
  );
}
