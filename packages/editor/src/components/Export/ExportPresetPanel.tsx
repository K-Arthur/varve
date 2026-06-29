/**
 * Export preset panel — per-node export configuration.
 *
 * Appears in the inspector's Export tab when a node is selected.
 * Each node can have multiple export presets (PNG@1x, PNG@2x, SVG, etc.).
 *
 * Follows the same pattern as other inspector sections (Section, control rows).
 */
import { useState } from 'react';
import type { ExportPreset, ExportFormat, SceneNode } from '@strata/scene';

interface ExportPresetPanelProps {
  node: SceneNode;
  onAddPreset: (preset: ExportPreset) => void;
  onUpdatePreset: (preset: ExportPreset) => void;
  onRemovePreset: (presetId: string) => void;
}

function createDefaultPreset(format: ExportFormat, index: number): ExportPreset {
  const scaleSettings = {
    scale: { type: 'factor' as const, value: format === 'svg' || format.startsWith('react') ? 1 : 2 },
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
    <div className="export-preset-panel" role="region" aria-label="Export presets">
      <Section title="Export">
        {presets.length === 0 && (
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-2)',
            }}
          >
            No export presets for this node.
          </div>
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

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-1)',
            marginTop: 'var(--space-2)',
          }}
        >
          <select
            value={selectedFormat}
            onChange={(e) => setSelectedFormat(e.target.value as ExportFormat)}
            aria-label="Format"
            style={{
              flex: 1,
              height: 'var(--space-5)',
              padding: '0 var(--space-2)',
              background: 'var(--color-surface-sunken)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            {(
              [
                ['png', 'PNG'],
                ['jpg', 'JPEG'],
                ['webp', 'WebP'],
                ['avif', 'AVIF'],
                ['svg', 'SVG'],
                ['pdf-screen', 'PDF (Screen)'],
                ['pdf-x1a', 'PDF/X-1a'],
                ['pdf-x4', 'PDF/X-4'],
                ['react-tailwind', 'React + Tailwind'],
                ['react-cssmodules', 'React + CSS Modules'],
                ['flutter', 'Flutter'],
                ['swiftui', 'SwiftUI'],
                ['svg-component', 'SVG Component'],
              ] as [ExportFormat, string][]
            ).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAdd}
            aria-label="Add preset"
            style={{
              height: 'var(--space-5)',
              padding: '0 var(--space-2)',
              background: 'var(--color-interactive-default)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: '#fff',
              fontSize: 'var(--font-size-sm)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            + Add
          </button>
        </div>
      </Section>
    </div>
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
    <div
      className="export-preset-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: 'var(--space-1) 0',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={preset.enabled}
          onChange={(e) => onUpdate({ ...preset, enabled: e.target.checked })}
          aria-label={`Enable ${formatLabel} preset`}
        />
      </label>
      <div style={{ flex: 1, fontSize: 'var(--font-size-sm)', lineHeight: 1.4 }}>
        <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {nodeName}{preset.suffix}.{preset.format}
        </div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>
          {formatLabel}, {scaleLabel}
        </div>
      </div>
      <input
        value={preset.suffix}
        onChange={(e) => onUpdate({ ...preset, suffix: e.target.value })}
        aria-label="Filename suffix"
        style={{
          width: 56,
          height: 'var(--space-4)',
          padding: '0 var(--space-1)',
          background: 'var(--color-surface-sunken)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-primary)',
          fontSize: 'var(--font-size-xs)',
          textAlign: 'center',
        }}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${formatLabel} preset`}
        style={{
          width: 'var(--space-4)',
          height: 'var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          fontSize: 'var(--font-size-sm)',
        }}
      >
        ×
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="inspector-section" style={{ padding: 'var(--space-2) 0' }}>
      <h3
        style={{
          fontSize: 'var(--font-size-xs)',
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          margin: 0,
          marginBottom: 'var(--space-1)',
          padding: '0 var(--space-2)',
        }}
      >
        {title}
      </h3>
      <div style={{ padding: '0 var(--space-2)' }}>{children}</div>
    </div>
  );
}
