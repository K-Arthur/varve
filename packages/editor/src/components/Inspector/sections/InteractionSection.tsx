/**
 * InteractionSection — prototype interaction editor for selected nodes.
 */
import type { DocumentInteraction } from '@strata/scene';
import { Button, Icon } from '@strata/ui';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

const DEFAULT_TRIGGER = { kind: 'onClick' as const };
const DEFAULT_ACTION = {
  kind: 'navigateTo' as const,
  targetId: '',
  transition: { kind: 'dissolve' as const, duration: 300, easing: { kind: 'ease' as const } },
};

export function InteractionSection() {
  const { selectedNodes, getNodeInteractions, addNodeInteraction, removeNodeInteraction } =
    useEditor();
  const nodes = selectedNodes();
  if (nodes.length !== 1) return null;
  const node = nodes[0];
  if (!node) return null;

  const interactions = getNodeInteractions(node.id);

  return (
    <DisclosureSection title="Prototype Interactions" defaultOpen>
      {interactions.length === 0 ? (
        <p className="insp-panel__empty-hint">No interactions on this layer.</p>
      ) : (
        <ul className="insp-interaction-list">
          {interactions.map((ix) => (
            <li key={ix.id} className="insp-interaction-row">
              <span className="insp-interaction-row__name">{ix.name}</span>
              <button
                type="button"
                className="insp-interaction-row__remove"
                aria-label={`Remove interaction ${ix.name}`}
                onClick={() => removeNodeInteraction(ix.id)}
              >
                <Icon name="Trash2" size={14} label="Remove" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          const payload: Omit<DocumentInteraction, 'id' | 'nodeId'> = {
            name: `Interaction ${interactions.length + 1}`,
            trigger: DEFAULT_TRIGGER,
            actions: [DEFAULT_ACTION],
            enabled: true,
          };
          addNodeInteraction(node.id, payload);
        }}
      >
        Add Interaction
      </Button>
    </DisclosureSection>
  );
}
