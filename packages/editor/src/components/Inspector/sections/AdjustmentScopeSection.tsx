/**
 * AdjustmentScopeSection — inspector panel for editing adjustment scope.
 *
 * Shows the current scope mode and allows changing it.
 * Renders when a single adjustment node is selected.
 */
import type { AdjustmentScope, Document, NodeId } from '@strata/scene';
import {
  collectAllEligibleNodes,
  estimateAdjustmentImpact,
  resolveAdjustmentScope,
  validateScope,
} from '@strata/scene';
import { Icon, Select } from '@strata/ui';
import { useCallback, useMemo, useState } from 'react';

export interface AdjustmentScopeSectionProps {
  nodeId: NodeId;
  doc: Document;
  scope: AdjustmentScope | undefined;
  onChangeScope: (scope: AdjustmentScope) => void;
}

export function AdjustmentScopeSection({
  nodeId,
  doc,
  scope,
  onChangeScope,
}: AdjustmentScopeSectionProps) {
  const [showImpact, setShowImpact] = useState(false);
  const [pendingScope, setPendingScope] = useState<AdjustmentScope | null>(null);

  const resolvedCount = useMemo(() => {
    if (!scope) return 0;
    return resolveAdjustmentScope(doc, scope, nodeId).length;
  }, [doc, scope, nodeId]);

  const warnings = useMemo(() => {
    if (!scope) return [];
    return validateScope(doc, scope);
  }, [doc, scope]);

  const impact = useMemo(() => {
    if (!scope) return null;
    return estimateAdjustmentImpact(doc, scope, nodeId);
  }, [doc, scope, nodeId]);

  const scopeMode = scope?.mode ?? 'legacy';
  const modeLabel =
    scopeMode === 'image-local'
      ? 'Single Image'
      : scopeMode === 'explicit-targets'
        ? `Explicit (${(scope?.mode === 'explicit-targets' ? scope.targetNodeIds : []).length} targets)`
        : scopeMode === 'container-descendant'
          ? 'Container Descendants'
          : scopeMode === 'document'
            ? 'Document'
            : 'Legacy (no scope)';

  const handleModeChange = useCallback(
    (newMode: string) => {
      switch (newMode) {
        case 'image-local': {
          // Convert to single-target scope targeting first eligible node
          const eligible = Object.values(doc.nodes).filter(
            (n) => n.kind === 'shape' || n.kind === 'rasterLayer',
          );
          if (eligible.length > 0 && eligible[0]) {
            if (eligible[0]) onChangeScope({ mode: 'image-local', targetNodeId: eligible[0].id });
          }
          break;
        }
        case 'explicit-targets': {
          // Convert to explicit scope with all eligible nodes
          const eligible = collectAllEligibleNodes(doc);
          onChangeScope({ mode: 'explicit-targets', targetNodeIds: eligible });
          break;
        }
        case 'container-descendant': {
          // Find parent container of this adjustment
          const parentId = findParentContainer(doc, nodeId);
          if (parentId) {
            onChangeScope({
              mode: 'container-descendant',
              containerId: parentId,
              includeNested: true,
            });
          }
          break;
        }
        case 'document':
          setPendingScope({ mode: 'document' });
          setShowImpact(true);
          break;
      }
    },
    [doc, nodeId, onChangeScope],
  );

  const handleConfirmGlobal = useCallback(() => {
    if (pendingScope) {
      onChangeScope(pendingScope);
      setShowImpact(false);
      setPendingScope(null);
    }
  }, [pendingScope, onChangeScope]);

  const scopeName =
    scopeMode === 'image-local'
      ? 'Single image'
      : scopeMode === 'explicit-targets'
        ? 'Multiple explicit targets'
        : scopeMode === 'container-descendant'
          ? 'Container descendants'
          : scopeMode === 'document'
            ? 'Document — all eligible nodes'
            : 'Legacy (no explicit scope)';

  return (
    <div className="insp-section">
      <div className="insp-section__header">
        <Icon name="SlidersHorizontal" label="" />
        <span>Adjustment Scope</span>
      </div>
      <div className="insp-field">
        <span className="insp-field__label">Mode</span>
        <span className="insp-field__value">{modeLabel}</span>
      </div>

      {scope && (
        <>
          <div className="insp-field">
            <span className="insp-field__label">Affected targets</span>
            <span className="insp-field__value">{resolvedCount}</span>
          </div>

          {impact && (
            <div className="insp-field">
              <span className="insp-field__label">Est. pixel area</span>
              <span className="insp-field__value">
                {(impact.estimatedPixelArea / 1000000).toFixed(1)} MPix
              </span>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="insp-field insp-field--warning">
              <span className="insp-field__label">Warnings</span>
              <span className="insp-field__value">
                {warnings.map((w) => (
                  <div key={w} className="insp-warning">
                    {w}
                  </div>
                ))}
              </span>
            </div>
          )}
        </>
      )}

      {/* Scope mode selector */}
      <div className="insp-field">
        <span className="insp-field__label">Change scope</span>
        <div className="insp-field__control">
          <Select
            label="Adjustment scope mode"
            value={scopeMode === 'legacy' ? '' : scopeMode}
            placeholder="— Select scope —"
            options={[
              { value: 'image-local', label: 'Single image' },
              { value: 'explicit-targets', label: 'Multiple targets' },
              { value: 'container-descendant', label: 'Container descendants' },
              { value: 'document', label: 'Document (global)' },
            ]}
            onChange={(v) => handleModeChange(v)}
          />
        </div>
      </div>

      <div className="insp-field insp-field--help">
        <span className="insp-field__value">{scopeName}</span>
      </div>

      {/* Impact summary dialog */}
      {showImpact && pendingScope && impact && (
        <div className="insp-overlay" role="dialog" aria-label="Adjustment impact preview">
          <div className="insp-overlay__content">
            <h3>Adjustment Impact</h3>
            <p>This adjustment will affect:</p>
            <ul>
              <li>{impact.targetCount} target(s)</li>
              <li>{impact.affectedFrames} frame(s)</li>
              <li>{impact.affectedPages} page(s)</li>
              <li>Est. {(impact.estimatedPixelArea / 1000000).toFixed(1)} MPix processed</li>
              <li>{impact.activeAdjustmentCount} active adjustment(s)</li>
              {impact.hasOffscreenTargets && <li>Off-screen targets will be deferred</li>}
            </ul>
            <div className="insp-overlay__actions">
              <button
                type="button"
                className="insp-btn insp-btn--secondary"
                onClick={() => setShowImpact(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="insp-btn insp-btn--primary"
                onClick={handleConfirmGlobal}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function findParentContainer(doc: Document, nodeId: NodeId): NodeId | null {
  for (const [id, n] of Object.entries(doc.nodes)) {
    if ('children' in n && n.children.includes(nodeId)) {
      return id;
    }
  }
  return null;
}
