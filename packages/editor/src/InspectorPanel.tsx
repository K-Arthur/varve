/**
 * Inspector / properties panel.
 * F1: uses selectedNodes()[0] so nested nodes work (doc.nodes lookup, not rootNodes().find).
 * A4: empty state shows document properties instead of a bare string.
 * B3: Export tab — SVG / React / PDF (stub) export.
 * B4: Spec tab — spacing, type styles, palette via buildSpec/specToMarkdown.
 * Supports: position (X/Y), size (W/H for shapes), fill (swatch + hex), text content, slots.
 */

import {
  buildSpec,
  exportDocumentToReact,
  exportDocumentToSvg,
  specToMarkdown,
} from '@strata/codegen';
import type { Color } from '@strata/engine';
import type { FlexDirection, FrameNode, LayoutMode, LayoutStyle } from '@strata/scene';
import { NumberInput } from '@strata/ui';
import { useState } from 'react';
import { SpecPanel } from './components/SpecPanel/SpecPanel';
import { useEditor } from './context';

type InspectorTab = 'properties' | 'export' | 'spec';

export function InspectorPanel() {
  const { state, selectedNodes, setNodePosition, setNodeSize, setSelectedFill, setNodeLayout } =
    useEditor();
  const sel = selectedNodes();
  const selected = sel[0];
  const selectedFrame = selected?.kind === 'frame' ? (selected as FrameNode) : null;
  let componentDef = null;
  if (selectedFrame?.componentId) {
    componentDef = state.document.components[selectedFrame.componentId] ?? null;
  }
  const [fillInput, setFillInput] = useState('');
  const [activeTab, setActiveTab] = useState<InspectorTab>('properties');

  function commitFill(raw: string) {
    const hex = raw.replace('#', '');
    if (hex.length !== 6) return;
    const m = /^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
    if (!m?.[1] || !m[2] || !m[3]) return;
    const color: Color = [
      Number.parseInt(m[1], 16),
      Number.parseInt(m[2], 16),
      Number.parseInt(m[3], 16),
      255,
    ];
    setSelectedFill(color);
  }

  return (
    <section className="editor-inspector" aria-label="Inspector">
      {/* Tab strip */}
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

      {activeTab === 'properties' && (
        <>
          {/* A14: empty state = document properties */}
          {!selected ? (
            <>
              <Section title="Document">
                <LabelledInput label="Name" value={state.document.name} readOnly />
                <LabelledInput
                  label="Layers"
                  value={String(state.document.rootChildren.length)}
                  readOnly
                />
              </Section>
              <Section title="Canvas">
                <LabelledInput label="Units" value="px" readOnly />
              </Section>
            </>
          ) : (
            <>
              <Section title={selected.name}>
                <LabelledInput label="Type" value={selected.kind} readOnly />
              </Section>
              <Section title="Position">
                <InspectorNumberInput
                  label="X"
                  value={Math.round(selected.transform[4] ?? 0)}
                  onChange={(v) => {
                    const t = selected.transform;
                    setNodePosition(selected.id, v, t[5] ?? 0);
                  }}
                />
                <InspectorNumberInput
                  label="Y"
                  value={Math.round(selected.transform[5] ?? 0)}
                  onChange={(v) => {
                    const t = selected.transform;
                    setNodePosition(selected.id, t[4] ?? 0, v);
                  }}
                />
              </Section>
              {selected.kind === 'shape' && (
                <>
                  <Section title="Size">
                    <InspectorNumberInput
                      label="W"
                      value={Math.round(rectW(selected.shape))}
                      onChange={(v) => {
                        const h = rectH(selected.shape);
                        setNodeSize(selected.id, v, h);
                      }}
                    />
                    <InspectorNumberInput
                      label="H"
                      value={Math.round(rectH(selected.shape))}
                      onChange={(v) => {
                        const w = rectW(selected.shape);
                        setNodeSize(selected.id, w, v);
                      }}
                    />
                  </Section>
                  <Section title="Fill">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 'var(--radius-sm)',
                          background: `rgba(${selected.fill[0]},${selected.fill[1]},${selected.fill[2]},${(selected.fill[3] / 255).toFixed(2)})`,
                          border: '1px solid var(--color-border-subtle)',
                          flexShrink: 0,
                        }}
                      />
                      <input
                        type="text"
                        value={
                          fillInput ||
                          `#${selected.fill
                            .slice(0, 3)
                            .map((c) => c.toString(16).padStart(2, '0'))
                            .join('')}`
                        }
                        onChange={(e) => setFillInput(e.target.value)}
                        onBlur={() => {
                          commitFill(fillInput);
                          setFillInput('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            commitFill(fillInput);
                            setFillInput('');
                          }
                        }}
                        aria-label="Fill color hex"
                        style={{
                          width: 72,
                          height: 'var(--space-5)',
                          padding: '0 var(--space-2)',
                          background: 'var(--color-surface-sunken)',
                          border: '1px solid var(--color-border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-primary)',
                          font: 'inherit',
                          fontSize: 'var(--font-size-xs)',
                        }}
                      />
                    </div>
                  </Section>
                </>
              )}
              {selected.kind === 'text' && (
                <Section title="Text">
                  <LabelledInput label="Content" value={selected.text} readOnly />
                </Section>
              )}
              {selected.kind === 'frame' && (
                <LayoutSection
                  node={selected as FrameNode}
                  onUpdate={(layout) => setNodeLayout(selected.id, layout)}
                />
              )}
              {componentDef && (
                <Section title="Slots">
                  {componentDef.slots.map((slot) => {
                    const fillId = selectedFrame?.slots?.[slot.id];
                    const fillNode = fillId ? state.document.nodes[fillId] : null;
                    return (
                      <div
                        key={slot.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 'var(--space-1)',
                        }}
                      >
                        <span style={{ fontSize: 'var(--font-size-xs)' }}>{slot.name}</span>
                        <span
                          style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {fillNode?.name ?? '(empty)'}
                        </span>
                      </div>
                    );
                  })}
                </Section>
              )}
            </>
          )}
        </>
      )}

      {state.tool === 'inspect' && sel.length > 0 && (
        <SpecPanel nodes={sel} doc={state.document} />
      )}
      {state.tool !== 'inspect' && activeTab === 'export' && <ExportTab doc={state.document} />}
      {state.tool !== 'inspect' && activeTab === 'spec' && <SpecTab doc={state.document} />}
    </section>
  );
}

/** B3: Export tab — SVG, React, PDF (stub). */
function ExportTab({ doc }: { doc: import('@strata/scene').Document }) {
  const [copied, setCopied] = useState<'svg' | 'react' | null>(null);

  function copyToClipboard(text: string, which: 'svg' | 'react') {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  function downloadText(text: string, filename: string, mime: string) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <Section title="Export">
        <ExportRow
          label="SVG"
          hint="Scalable vector — paste into HTML or Figma"
          onCopy={() => copyToClipboard(exportDocumentToSvg(doc), 'svg')}
          onDownload={() =>
            downloadText(exportDocumentToSvg(doc), `${doc.name}.svg`, 'image/svg+xml')
          }
          copyLabel={copied === 'svg' ? 'Copied!' : 'Copy SVG'}
        />
        <ExportRow
          label="React"
          hint="JSX component — paste into your project"
          onCopy={() => copyToClipboard(exportDocumentToReact(doc), 'react')}
          onDownload={() =>
            downloadText(exportDocumentToReact(doc), `${doc.name}.tsx`, 'text/plain')
          }
          copyLabel={copied === 'react' ? 'Copied!' : 'Copy JSX'}
        />
      </Section>
      <Section title="Print / PDF">
        <div
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
            marginBottom: 'var(--space-1)',
          }}
        >
          Preview only — not production-certified
        </div>
        <ExportRow
          label="PDF"
          hint="RGB colors, fonts outlined"
          onCopy={undefined}
          onDownload={() => alert('PDF export requires the Tauri desktop build.')}
          copyLabel={undefined}
        />
        <ExportRow
          label="PDF/X-1a"
          hint="CMYK · stub — honours format but output is RGB"
          onCopy={undefined}
          onDownload={() => alert('PDF/X export requires the Tauri desktop build.')}
          copyLabel={undefined}
        />
      </Section>
    </div>
  );
}

function ExportRow({
  label,
  hint,
  onCopy,
  onDownload,
  copyLabel,
}: {
  label: string;
  hint: string;
  onCopy?: () => void;
  onDownload: () => void;
  copyLabel?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        marginBottom: 'var(--space-1)',
      }}
    >
      <span style={{ flex: 1, fontSize: 'var(--font-size-xs)' }} title={hint}>
        {label}
      </span>
      {onCopy && copyLabel && (
        <button
          type="button"
          onClick={onCopy}
          style={{
            fontSize: 'var(--font-size-xs)',
            padding: '2px 6px',
            background: 'var(--color-surface-sunken)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
        >
          {copyLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onDownload}
        style={{
          fontSize: 'var(--font-size-xs)',
          padding: '2px 6px',
          background: 'var(--color-interactive-default)',
          color: 'var(--color-text-on-accent)',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
        }}
      >
        Download
      </button>
    </div>
  );
}

/** B4: Spec inspector tab — spacing, type styles, palette. */
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
        <Section title="Palette">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
            {spec.palette.map((c, i) => (
              <div
                key={i}
                title={`rgba(${c[0]},${c[1]},${c[2]},${c[3]})`}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 'var(--radius-sm)',
                  background: `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(2)})`,
                  border: '1px solid var(--color-border-subtle)',
                }}
              />
            ))}
          </div>
        </Section>
      )}

      {spec.spacings.length > 0 && (
        <Section title="Spacing">
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
        </Section>
      )}

      {spec.typeStyles.length > 0 && (
        <Section title="Type styles">
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
        </Section>
      )}

      {spec.nodes.length === 0 && spec.spacings.length === 0 && spec.typeStyles.length === 0 && (
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
          Add nodes to the canvas to see spec data.
        </p>
      )}
    </div>
  );
}

/** B2: Layout controls shown when a FrameNode is selected. */
function LayoutSection({
  node,
  onUpdate,
}: {
  node: FrameNode;
  onUpdate: (layout: LayoutStyle | undefined) => void;
}) {
  const ls = node.layoutStyle;

  function patch(partial: Partial<LayoutStyle>) {
    const base: LayoutStyle = ls ?? {
      mode: 'flex',
      direction: 'row',
      gap: 0,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 1,
    };
    onUpdate({ ...base, ...partial });
  }

  return (
    <Section title="Layout">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span
          style={{ width: 60, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}
        >
          Mode
        </span>
        <select
          value={ls?.mode ?? 'none'}
          onChange={(e) => {
            if (e.target.value === 'none') onUpdate(undefined);
            else patch({ mode: e.target.value as LayoutMode });
          }}
          style={{
            flex: 1,
            fontSize: 'var(--font-size-xs)',
            background: 'var(--color-surface-sunken)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 4px',
          }}
        >
          <option value="none">None</option>
          <option value="flex">Flex</option>
          <option value="grid">Grid</option>
        </select>
      </div>
      {ls && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              style={{
                width: 60,
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)',
              }}
            >
              Direction
            </span>
            <select
              value={ls.direction}
              onChange={(e) => patch({ direction: e.target.value as FlexDirection })}
              style={{
                flex: 1,
                fontSize: 'var(--font-size-xs)',
                background: 'var(--color-surface-sunken)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 4px',
              }}
            >
              <option value="row">Row</option>
              <option value="column">Column</option>
              <option value="rowReverse">Row reverse</option>
              <option value="columnReverse">Column reverse</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              style={{
                width: 60,
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)',
              }}
            >
              Gap
            </span>
            <NumberInput
              id="layout-gap"
              label="Gap"
              value={ls.gap}
              step={1}
              shiftStep={10}
              altStep={0.5}
              onChange={(v) => patch({ gap: v })}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              style={{
                width: 60,
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)',
              }}
            >
              Wrap
            </span>
            <input
              type="checkbox"
              checked={ls.wrap}
              onChange={(e) => patch({ wrap: e.target.checked })}
              aria-label="Wrap"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span
              style={{
                width: 60,
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)',
              }}
            >
              Padding
            </span>
            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
              {(['T', 'R', 'B', 'L'] as const).map((side, i) => (
                <input
                  key={side}
                  type="number"
                  aria-label={`Padding ${side}`}
                  value={ls.padding[i] ?? 0}
                  step={1}
                  onChange={(e) => {
                    const p = [...ls.padding] as [number, number, number, number];
                    p[i] = Number(e.target.value) || 0;
                    patch({ padding: p });
                  }}
                  style={{
                    width: 36,
                    fontSize: 'var(--font-size-xs)',
                    background: 'var(--color-surface-sunken)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '2px 4px',
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

function rectW(shape: { kind: string } & Record<string, unknown>): number {
  if (shape.kind === 'rect') return Number(shape.w ?? 0);
  if (shape.kind === 'ellipse') return Number(shape.rx ?? 0);
  if (shape.kind === 'circle') return Number(shape.r ?? 0);
  if (shape.kind === 'polygon') return Number(shape.radius ?? 0);
  if (shape.kind === 'star') return Number(shape.outerRadius ?? 0);
  return 0;
}
function rectH(shape: { kind: string } & Record<string, unknown>): number {
  if (shape.kind === 'rect') return Number(shape.h ?? 0);
  if (shape.kind === 'ellipse') return Number(shape.ry ?? 0);
  if (shape.kind === 'circle') return Number(shape.r ?? 0);
  if (shape.kind === 'polygon') return Number(shape.radius ?? 0);
  if (shape.kind === 'star') return Number(shape.outerRadius ?? 0);
  return 0;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="editor-inspector__group">
      <div className="editor-inspector__group-title">{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {children}
      </div>
    </div>
  );
}

function LabelledInput({
  label,
  value = '',
  readOnly = false,
  onChange,
}: {
  label: string;
  value?: string;
  readOnly?: boolean;
  onChange?: (val: string) => void;
}) {
  const id = `insp-${label}`;
  const [dirty, setDirty] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <label
        htmlFor={id}
        style={{ width: 60, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={dirty ?? value}
        readOnly={readOnly}
        onChange={(e) => {
          if (readOnly) return;
          setDirty(e.target.value);
        }}
        onBlur={() => {
          if (dirty !== null && onChange) onChange(dirty);
          setDirty(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && dirty !== null && onChange) {
            onChange(dirty);
            setDirty(null);
          }
        }}
        style={{
          flex: 1,
          height: 'var(--space-5)',
          padding: '0 var(--space-2)',
          background: 'var(--color-surface-sunken)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-sm)',
          color: readOnly ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
          font: 'inherit',
          fontSize: 'var(--font-size-sm)',
        }}
      />
    </div>
  );
}

function InspectorNumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const id = `insp-${label}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <label
        htmlFor={id}
        style={{ width: 60, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}
      >
        {label}
      </label>
      <NumberInput
        id={id}
        label={label}
        value={value}
        step={1}
        shiftStep={10}
        altStep={0.1}
        onChange={onChange}
      />
    </div>
  );
}
