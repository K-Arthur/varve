import { useEditor } from '../../../context';
import type { IntelligenceTab } from '../../../context/types';
import { IntelligencePanel } from '../../../panels/IntelligencePanel';
import { AdaptiveContrastSection } from '../sections/AdaptiveContrastSection';
import { CognitiveLoadSection } from '../sections/CognitiveLoadIndicator';

/**
 * Insights — the document-level review surface inside the Design tab.
 *
 * Composition order is deliberate: selection-scoped diagnostics first
 * (adaptive contrast for text layers, cognitive load when the score is
 * non-zero), then the full review panel whose tabs are filtered by
 * applicability. Every child here returns nothing when it has nothing to
 * say, so an expanded Insights section never shows empty headers.
 */
export function AuditPanel({ request }: { request: { subTab?: IntelligenceTab; seq: number } }) {
  const { selectedNodes, state } = useEditor();
  const nodes = selectedNodes();
  const allText = nodes.length > 0 && nodes.every((node) => node.kind === 'text');

  return (
    <>
      {allText && <AdaptiveContrastSection nodes={nodes} />}
      {nodes.length > 0 && (
        <CognitiveLoadSection
          document={state.document}
          nodeId={nodes.length === 1 ? nodes[0]!.id : null}
        />
      )}
      <IntelligencePanel key={request.seq} initialTab={request.subTab} />
    </>
  );
}
