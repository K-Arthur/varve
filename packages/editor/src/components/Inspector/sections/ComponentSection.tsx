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
        <span className="insp-component__name">{componentName}</span>
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

      <div className="insp-component-actions">
        <button
          type="button"
          className="insp-component-action-btn"
          onClick={() => editor.resetInstanceOverrides(node.id)}
          disabled={overrides.length === 0}
          aria-label="Reset overrides to master defaults"
        >
          Reset
        </button>
        <button
          type="button"
          className="insp-component-action-btn"
          onClick={() => editor.detachSelected()}
          aria-label="Detach instance to plain frame"
        >
          Detach
        </button>
      </div>

      {/* Override indicators */}
      {overrides.length > 0 && (
        <div className="insp-component-overrides">
          <div className="insp-empty-message insp-empty-message--tight">Overridden properties</div>
          <div className="insp-component-override-chips">
            {overrides.map((prop) => (
              <span key={prop} className="insp-component-override-chip">
                {prop}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Slot fills */}
      {component?.slots && component.slots.length > 0 && (
        <div className="insp-component-slots">
          <div className="insp-empty-message insp-empty-message--tight">Slots</div>
          {component.slots.map((slot) => {
            const fillNodeId = node.slots?.[slot.id];

            return (
              <div key={slot.id} className="insp-component-slot-row">
                <span className="insp-component-slot-row__name">{slot.name}</span>
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
                    } else {
                      editor.clearSlot(node.id, slot.id);
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
