import { useEditor } from '../../../context';
import type { IntelligenceTab } from '../../../context/types';
import { IntelligencePanel } from '../../../panels/IntelligencePanel';
import { DisclosureSection } from '../controls/DisclosureSection';
import { AdaptiveContrastSection } from '../sections/AdaptiveContrastSection';
import { CognitiveLoadIndicator } from '../sections/CognitiveLoadIndicator';

export function AuditPanel({ request }: { request: { subTab?: IntelligenceTab; seq: number } }) {
  const { selectedNodes, state } = useEditor();
  const nodes = selectedNodes();
  const allText = nodes.length > 0 && nodes.every((node) => node.kind === 'text');

  return (
    <>
      {allText && <AdaptiveContrastSection nodes={nodes} />}
      {nodes.length > 0 && (
        <DisclosureSection
          title="Cognitive Load"
          sectionId="cognitive-load"
          defaultExpanded={false}
        >
          <CognitiveLoadIndicator
            document={state.document}
            nodeId={nodes.length === 1 ? nodes[0]!.id : null}
          />
        </DisclosureSection>
      )}
      <IntelligencePanel key={request.seq} initialTab={request.subTab} />
    </>
  );
}
