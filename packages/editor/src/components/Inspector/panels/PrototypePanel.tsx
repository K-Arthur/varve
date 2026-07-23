import { EmptyState } from '@strata/ui';
import { useEditor } from '../../../context';
import { PrototypeFlowView } from '../../Prototype/PrototypeFlowView';
import { DisclosureSection } from '../controls/DisclosureSection';
import { InteractionSection } from '../sections/InteractionSection';

/** Selection interactions plus the document-wide flow in one durable workflow. */
export function PrototypePanel() {
  const {
    selectedNodes,
    state,
    navigatePrototypeTo,
    prototypeCurrentScreen,
    selectedInteractionId,
    selectPrototypeInteraction,
  } = useEditor();
  const nodes = selectedNodes();

  return (
    <>
      {nodes.length === 1 ? (
        <InteractionSection />
      ) : (
        <EmptyState
          illustration={<span aria-hidden />}
          headline="Select one object"
          description="Select a frame or layer to add triggers and actions."
        />
      )}
      <DisclosureSection title="Prototype Flow" sectionId="prototype-flow" defaultExpanded>
        <PrototypeFlowView
          document={state.document}
          currentScreenId={prototypeCurrentScreen}
          selectedInteractionId={selectedInteractionId}
          onSelectScreen={navigatePrototypeTo}
          onSelectInteraction={selectPrototypeInteraction}
        />
      </DisclosureSection>
    </>
  );
}
