/**
 * Inspector panel — property groups for the selected node (Strata plan §5.6).
 *
 * Displays labeled, keyboard-accessible inputs for position, size, rotation,
 * fill, and typography. Each input uses the labelled-field pattern (htmlFor/id).
 */

import { useEditor } from './context';

export function InspectorPanel() {
  const { state } = useEditor();

  return (
    <section className="editor-inspector" aria-label="Inspector">
      {!state.selection && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
          Select a layer to inspect
        </p>
      )}
      {state.selection && (
        <>
          <Section title="Position">
            <LabelledInput label="X" />
            <LabelledInput label="Y" />
          </Section>
          <Section title="Size">
            <LabelledInput label="W" />
            <LabelledInput label="H" />
          </Section>
          <Section title="Fill">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-interactive-default)',
                }}
              />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                #39d0c6
              </span>
            </div>
          </Section>
          <Section title="Transform">
            <LabelledInput label="Rotate" value="0°" />
          </Section>
        </>
      )}
    </section>
  );
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

function LabelledInput({ label, value = '0' }: { label: string; value?: string }) {
  const id = `insp-${label}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <label
        htmlFor={id}
        style={{
          width: 32,
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-muted)',
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        defaultValue={value}
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
