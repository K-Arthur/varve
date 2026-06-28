/**
 * Inspector panel — property groups for the selected node (Strata plan §5.6).
 */
import type React from 'react';
import { useEditor } from './context';

export function InspectorPanel() {
  const { state, rootNodes } = useEditor();
  const selected = state.selection ? rootNodes().find((n) => n.id === state.selection) : null;

  return (
    <section className="editor-inspector" aria-label="Inspector">
      {!selected && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
          Select a layer to inspect
        </p>
      )}
      {selected && (
        <>
          <Section title={selected.name}>
            <LabelledInput label="Type" value={selected.kind} />
          </Section>
          <Section title="Position">
            <LabelledInput label="X" value={String(selected.transform[4])} />
            <LabelledInput label="Y" value={String(selected.transform[5])} />
          </Section>
          {selected.kind === 'shape' && (
            <>
              <Section title="Size">
                <LabelledInput label="W" value={String(rectW(selected.shape))} />
                <LabelledInput label="H" value={String(rectH(selected.shape))} />
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
                  <span
                    style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}
                  >
                    #
                    {selected.fill
                      .slice(0, 3)
                      .map((c) => c.toString(16).padStart(2, '0'))
                      .join('')}
                  </span>
                </div>
              </Section>
            </>
          )}
          {selected.kind === 'text' && (
            <Section title="Text">
              <LabelledInput label="Content" value={selected.text} />
            </Section>
          )}
        </>
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

function LabelledInput({ label, value = '' }: { label: string; value?: string }) {
  const id = `insp-${label}`;
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
        defaultValue={value}
        readOnly
        style={{
          flex: 1,
          height: 'var(--space-5)',
          padding: '0 var(--space-2)',
          background: 'var(--color-surface-sunken)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-text-primary)',
          font: 'inherit',
          fontSize: 'var(--font-size-sm)',
        }}
      />
    </div>
  );
}
