/**
 * Component section — component instance controls for a FrameNode.
 *
 * Shows when a FrameNode is a component instance (has componentId).
 * Displays component name, swap/detach/override controls, and slot fills.
 *
 * Research basis: Figma component instance panel with slot fills.
 */
import type { FrameNode } from '@strata/scene';
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

  return (
    <DisclosureSection title="Component">
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <span
          style={{
            fontSize: 'var(--font-size-xs)',
            fontWeight: 500,
            color: 'var(--color-text-primary)',
          }}
        >
          {componentName}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
        <button
          type="button"
          onClick={() => {
            // TODO: Implement component swap
            console.log('Swap component');
          }}
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
        >
          Swap
        </button>
        <button
          type="button"
          onClick={() => {
            // TODO: Implement reset overrides
            console.log('Reset overrides');
          }}
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
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => {
            editor.detachSelected();
          }}
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
        >
          Detach
        </button>
      </div>

      {component?.slots && component.slots.length > 0 && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-1)',
            }}
          >
            Slots
          </div>
          {component.slots.map((slot) => {
            const fillNodeId = node.slots?.[slot.id];
            const fillNode = fillNodeId ? editor.state.document.nodes[fillNodeId] : null;
            const fillName = fillNode?.name ?? 'Empty';

            return (
              <div
                key={slot.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
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
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                  {fillName}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </DisclosureSection>
  );
}
