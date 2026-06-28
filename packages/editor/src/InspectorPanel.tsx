import type { Color } from '@strata/engine';
import { NumberInput } from '@strata/ui';
import { useState } from 'react';
import { useEditor } from './context';

export function InspectorPanel() {
  const { state, rootNodes, setNodePosition, setNodeSize, setSelectedFill } = useEditor();
  const selected = state.selection ? rootNodes().find((n) => n.id === state.selection) : null;
  const [fillInput, setFillInput] = useState('');

  if (!selected) {
    return (
      <section className="editor-inspector" aria-label="Inspector">
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
          Select a layer to inspect
        </p>
      </section>
    );
  }

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
    </section>
  );
}

function rectW(shape: { kind: string } & Record<string, unknown>): number {
  if (shape.kind === 'rect') return Number(shape.w ?? 0);
  if (shape.kind === 'ellipse') return Number(shape.rx ?? 0);
  if (shape.kind === 'circle') return Number(shape.r ?? 0);
  return 0;
}
function rectH(shape: { kind: string } & Record<string, unknown>): number {
  if (shape.kind === 'rect') return Number(shape.h ?? 0);
  if (shape.kind === 'ellipse') return Number(shape.ry ?? 0);
  if (shape.kind === 'circle') return Number(shape.r ?? 0);
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
