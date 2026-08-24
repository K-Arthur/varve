/**
 * ComponentSection — component instance controls for a FrameNode.
 *
 * Shows when a FrameNode is a component instance (has componentId).
 * Displays component name, swap/reset/detach controls, slot fills (with
 * fill-from-existing-node), and an override indicator listing properties that
 * differ from the master.
 *
 * Research basis: Figma component instance panel with slot fills and overrides.
 */
import type { ComponentDefinition, Document, FrameNode, SceneNode } from '@varve/scene';
import { instanceOverrides } from '@varve/scene';
import { Select } from '@varve/ui';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

export function ComponentSection({ node }: { node: FrameNode }) {
  const editor = useEditor();
  const componentId = node.componentId;

  if (!componentId) {
    return null;
  }

  const component = editor.state.document.components[componentId];
  const componentName = component?.name ?? 'Unknown Component';
  const doc = editor.state.document as Document;

  // All available components for swap
  const allComponents = Object.values(doc.components) as ComponentDefinition[];
  // All root-level nodes available as slot fill candidates
  const fillCandidates = (Object.values(doc.nodes) as SceneNode[]).filter(
    (n) => n.id !== node.id && n.kind !== 'frame',
  );

  // Detect overridden properties
  const overrides = instanceOverrides(doc, node.id);

  return (
    <DisclosureSection title="Component" sectionId="component">
      <div className="insp-empty-message">
        <span
          style={{
            fontWeight: 'var(--font-weight-medium)',
            color: 'var(--color-text-primary)',
          }}
        >
          {componentName}
        </span>
      </div>

      {/* Swap control */}
      <div className="insp-field" style={{ marginBottom: 'var(--space-2)' }}>
        <span className="insp-field__label">Swap</span>
        <div className="insp-field__control">
          <Select
            label="Swap component instance"
            value={componentId}
            options={allComponents.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => editor.swapComponentInstance(node.id, v)}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
        <button
          type="button"
          onClick={() => editor.resetInstanceOverrides(node.id)}
          disabled={overrides.length === 0}
          style={{
            flex: 1,
            padding: 'var(--space-1) var(--space-2)',
            fontSize: 'var(--font-size-xs)',
            background: 'var(--color-surface-sunken)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            cursor: overrides.length === 0 ? 'not-allowed' : 'pointer',
            color: 'var(--color-text-primary)',
            opacity: overrides.length === 0 ? 0.5 : 1,
          }}
          aria-label="Reset overrides to master defaults"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => editor.detachSelected()}
          style={{
            flex: 1,
            padding: 'var(--space-1) var(--space-2)',
            fontSize: 'var(--font-size-xs)',
            background: 'var(--color-surface-sunken)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            color: 'var(--color-text-primary)',
          }}
          aria-label="Detach instance to plain frame"
        >
          Detach
        </button>
      </div>

      {/* Override indicators */}
      {overrides.length > 0 && (
        <div style={{ marginBottom: 'var(--space-2)' }}>
          <div className="insp-empty-message" style={{ padding: '0 0 var(--space-1)' }}>
            Overridden properties
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
            {overrides.map((prop) => (
              <span
                key={prop}
                style={{
                  fontSize: 'var(--font-size-xs)',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)',
                  background:
                    'color-mix(in oklch, var(--color-interactive-default) 15%, transparent)',
                  color: 'var(--color-text-on-accent, var(--color-accent-primary))',
                  border:
                    '1px solid color-mix(in oklch, var(--color-interactive-default) 30%, transparent)',
                }}
              >
                {prop}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Slot fills */}
      {component?.slots && component.slots.length > 0 && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <div className="insp-empty-message" style={{ padding: '0 0 var(--space-1)' }}>
            Slots
          </div>
          {component.slots.map((slot) => {
            const fillNodeId = node.slots?.[slot.id];

            return (
              <div
                key={slot.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-1)',
                  padding: 'var(--space-1)',
                  background: 'var(--color-surface-sunken)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                <span
                  style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}
                >
                  {slot.name}
                </span>
                <Select
                  label={`Fill slot ${slot.name}`}
                  value={fillNodeId ?? ''}
                  options={[
                    { value: '', label: 'Empty' },
                    ...fillCandidates.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  onChange={(v) => {
                    if (v) {
                      editor.fillSlot(node.id, slot.id, v);
                    }
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </DisclosureSection>
  );
}
