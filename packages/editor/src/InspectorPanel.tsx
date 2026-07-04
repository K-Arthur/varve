/**
 * Inspector panel — tab wrapper around Properties, Export, and Spec.
 * B3: Export tab — per-node preset management (ExportPresetPanel).
 * B4: Spec tab — spacing, type styles, palette via buildSpec/specToMarkdown.
 */

import { managedColorToRgba } from '@strata/shared';
import { buildSpec, specToMarkdown } from '@strata/codegen';
import { useState } from 'react';
import { ExportPresetPanel } from './components/Export/ExportPresetPanel';
import { PropertiesPanel } from './components/Inspector/PropertiesPanel';
import { useEditor } from './context';

type InspectorTab = 'properties' | 'export' | 'spec';

export function InspectorPanel() {
  const { state } = useEditor();
  const [activeTab, setActiveTab] = useState<InspectorTab>('properties');

  return (
    <div className="editor-inspector">
      <div
        role="tablist"
        aria-label="Inspector tabs"
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--color-border-subtle)',
          marginBottom: 'var(--space-2)',
          gap: 0,
        }}
      >
        {(['properties', 'export', 'spec'] as InspectorTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: 'var(--space-1) 0',
              background: 'none',
              border: 'none',
              borderBottom:
                activeTab === tab
                  ? '2px solid var(--color-interactive-default)'
                  : '2px solid transparent',
              color: activeTab === tab ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              fontSize: 'var(--font-size-xs)',
              fontFamily: 'inherit',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'properties' && <PropertiesPanel />}
      {activeTab === 'export' && <ExportTab />}
      {activeTab === 'spec' && <SpecTab doc={state.document} />}
    </div>
  );
}

function ExportTab() {
  const { selectedNodes, addPreset, updatePreset, removePreset } = useEditor();
  const sel = selectedNodes();
  const selected = sel[0];

  if (!selected) {
    return (
      <div
        style={{
          padding: 'var(--space-2)',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
        }}
      >
        Select a node to configure export presets.
      </div>
    );
  }

  return (
    <ExportPresetPanel
      node={selected}
      onAddPreset={(preset) => addPreset(selected.id, preset)}
      onUpdatePreset={(preset) => updatePreset(selected.id, preset)}
      onRemovePreset={(presetId) => removePreset(selected.id, presetId)}
    />
  );
}

function SpecTab({ doc }: { doc: import('@strata/scene').Document }) {
  const [copied, setCopied] = useState(false);
  const spec = buildSpec(doc);

  function copyMarkdown() {
    navigator.clipboard.writeText(specToMarkdown(spec)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-2)' }}>
        <button
          type="button"
          onClick={copyMarkdown}
          style={{
            fontSize: 'var(--font-size-xs)',
            padding: '2px 8px',
            background: 'var(--color-surface-sunken)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
        >
          {copied ? 'Copied!' : 'Copy Markdown'}
        </button>
      </div>

      {spec.palette.length > 0 && (
        <SpecSection title="Palette">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
            {spec.palette.map((c, i) => {
              const [r, g, b, a] = managedColorToRgba(c);
              return (
                <div
                  key={i}
                  title={`rgba(${r},${g},${b},${a})`}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 'var(--radius-sm)',
                    background: `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`,
                    border: '1px solid var(--color-border-subtle)',
                  }}
                />
              );
            })}
          </div>
        </SpecSection>
      )}

      {spec.spacings.length > 0 && (
        <SpecSection title="Spacing">
          {spec.spacings.map((s) => (
            <div
              key={s.name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 'var(--font-size-xs)',
              }}
            >
              <span style={{ color: 'var(--color-text-muted)' }}>{s.name}</span>
              <span>{s.value}px</span>
            </div>
          ))}
        </SpecSection>
      )}

      {spec.typeStyles.length > 0 && (
        <SpecSection title="Type styles">
          {spec.typeStyles.map((ts) => (
            <div
              key={ts.name}
              style={{ fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-1)' }}
            >
              <div>{ts.name}</div>
              <div style={{ color: 'var(--color-text-muted)' }}>
                {ts.fontFamily ?? 'system-ui'} {ts.fontSize}px
                {ts.fontWeight ? ` / ${ts.fontWeight}` : ''}
              </div>
            </div>
          ))}
        </SpecSection>
      )}

      {spec.nodes.length === 0 && spec.spacings.length === 0 && spec.typeStyles.length === 0 && (
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
          Add nodes to the canvas to see spec data.
        </p>
      )}
    </div>
  );
}

function SpecSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="editor-inspector__group">
      <div className="editor-inspector__group-title">{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {children}
      </div>
    </div>
  );
}
