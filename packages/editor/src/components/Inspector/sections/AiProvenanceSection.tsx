/**
 * AiProvenanceSection — displays AI edit provenance for selected layers.
 *
 * Shows which AI tool, model, and timestamp when a layer was created or
 * modified by AI operations (Generative Edit, Background Removal, etc.).
 * Only renders when the selected node has AI edit history.
 */

import type { NodeId } from '@varve/scene';
import { useEditor } from '../../../context';
import { formatAiEditTimestamp, getNodeAiEditInfo } from '../../LayersPanel/aiEditedBadge';
import { DisclosureSection } from '../controls/DisclosureSection';
import './AiProvenanceSection.css';

export function AiProvenanceSection() {
  const { state } = useEditor();
  const doc = state.document;

  // Only show for single selection
  if (state.selection.length !== 1) {
    return null;
  }

  const nodeId = state.selection[0] as NodeId;
  const aiInfo = getNodeAiEditInfo(doc, nodeId);

  if (!aiInfo) {
    return null;
  }

  return (
    <DisclosureSection title="AI Edit History" sectionId="ai-provenance">
      <div className="ai-provenance">
        <dl className="ai-provenance__list">
          <div className="ai-provenance__item">
            <dt className="ai-provenance__label">Tool</dt>
            <dd className="ai-provenance__value">{aiInfo.label}</dd>
          </div>

          <div className="ai-provenance__item">
            <dt className="ai-provenance__label">Model</dt>
            <dd className="ai-provenance__value">{aiInfo.model}</dd>
          </div>

          <div className="ai-provenance__item">
            <dt className="ai-provenance__label">Edited</dt>
            <dd className="ai-provenance__value">{formatAiEditTimestamp(aiInfo.timestamp)}</dd>
          </div>

          {aiInfo.mode && (
            <div className="ai-provenance__item">
              <dt className="ai-provenance__label">Mode</dt>
              <dd className="ai-provenance__value ai-provenance__value--mode">{aiInfo.mode}</dd>
            </div>
          )}
        </dl>

        <p className="ai-provenance__note">
          This layer was created or modified using AI. Provenance is preserved across edits and
          exports (when disclosure is enabled).
        </p>
      </div>
    </DisclosureSection>
  );
}
