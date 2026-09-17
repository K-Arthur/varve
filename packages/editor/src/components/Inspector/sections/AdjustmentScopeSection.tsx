/**
 * AdjustmentScopeSection — inspector panel for editing adjustment scope.
 *
 * Shows the current scope mode and allows changing it.
 * Renders when a single adjustment node is selected.
 */
import type { AdjustmentScope, Document, NodeId } from '@varve/scene';
import {
  estimateAdjustmentImpact,
  isAdjustmentEligible,
  resolveAdjustmentScope,
  validateScope,
} from '@varve/scene';
import { Button, Dialog, Icon, Select } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';

export interface AdjustmentScopeSectionProps {
  nodeId: NodeId;
  doc: Document;
  scope: AdjustmentScope | undefined;
  onChangeScope: (scope: AdjustmentScope) => void;
}

/**
 * One vocabulary for scope modes. The read-only summary, the selector, and the
 * impact dialog previously used three different names for the same mode
 * ("Single Image" / "Single image", "Explicit (N targets)" / "Multiple
 * targets", "Multiple explicit targets").
 */
const SCOPE_MODE_LABELS = {
  'image-local': 'Single image',
  'explicit-targets': 'Multiple targets',
  'container-descendant': 'Container descendants',
  document: 'Document (global)',
} as const satisfies Record<AdjustmentScope['mode'], string>;

const SCOPE_MODE_OPTIONS = Object.entries(SCOPE_MODE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

export function AdjustmentScopeSection({
  nodeId,
  doc,
  scope,
  onChangeScope,
}: AdjustmentScopeSectionProps) {
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

  const pendingImpact = useMemo(() => {
    if (!pendingScope) return null;
    return estimateAdjustmentImpact(doc, pendingScope, nodeId);
  }, [doc, nodeId, pendingScope]);

  const eligibleTargets = useMemo(
    () =>
      Object.values(doc.nodes)
        .filter((node) => {
          if (node.id === nodeId || !isAdjustmentEligible(node)) return false;
          // Use the same scene-aware resolver as rendering. A node below a
          // hidden ancestor is not an actionable target even if its own
          // `visible` flag is true.
          return resolveAdjustmentScope(
            doc,
            { mode: 'image-local', targetNodeId: node.id },
            nodeId,
          ).includes(node.id);
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [doc, nodeId],
  );

  const explicitTargetIds = useMemo(() => {
    if (scope?.mode === 'explicit-targets') return new Set(scope.targetNodeIds);
    return new Set(resolveAdjustmentScope(doc, scope, nodeId));
  }, [doc, nodeId, scope]);

  const scopeMode = scope?.mode;
  const modeLabel = scopeMode ? SCOPE_MODE_LABELS[scopeMode] : 'Not set';

  const handleModeChange = useCallback(
    (newMode: string) => {
      switch (newMode) {
        case 'image-local': {
          // Preserve the current target when possible. Otherwise choose the
          // first eligible raster or vector node rather than silently falling
          // back to an arbitrary image-only target.
          const currentTarget =
            scope?.mode === 'image-local' &&
            eligibleTargets.some((n) => n.id === scope.targetNodeId)
              ? doc.nodes[scope.targetNodeId]
              : undefined;
          const target =
            currentTarget && isAdjustmentEligible(currentTarget)
              ? currentTarget
              : eligibleTargets[0];
          if (target) onChangeScope({ mode: 'image-local', targetNodeId: target.id });
          break;
        }
        case 'explicit-targets': {
          // Preserve the current resolved set so switching modes does not
          // unexpectedly broaden an adjustment to every layer in the file.
          const current = resolveAdjustmentScope(doc, scope, nodeId);
          onChangeScope({ mode: 'explicit-targets', targetNodeIds: current });
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
          break;
      }
    },
    [doc, eligibleTargets, nodeId, onChangeScope, scope],
  );

  const toggleExplicitTarget = useCallback(
    (targetId: NodeId) => {
      const next = new Set(explicitTargetIds);
      if (next.has(targetId)) next.delete(targetId);
      else next.add(targetId);
      onChangeScope({ mode: 'explicit-targets', targetNodeIds: [...next] });
    },
    [explicitTargetIds, onChangeScope],
  );

  const cancelPendingScope = useCallback(() => setPendingScope(null), []);

  const handleConfirmGlobal = useCallback(() => {
    if (pendingScope) {
      onChangeScope(pendingScope);
      setPendingScope(null);
    }
  }, [pendingScope, onChangeScope]);

  return (
    <div className="insp-section">
      <div className="insp-section__header">
        <Icon name="SlidersHorizontal" />
        <span>Adjustment Scope</span>
      </div>
      <div className="insp-field">
        <span className="insp-field__label">Mode</span>
        <span className="insp-field__value">{modeLabel}</span>
      </div>

      {scope && (
        <>
          <div className="insp-field">
            <span className="insp-field__label insp-field__label--wrap">Affected targets</span>
            <span className="insp-field__value">{resolvedCount}</span>
          </div>

          {/* A zero-area estimate is noise on an inactive layer; the warning
              below already explains that nothing is targeted. */}
          {impact && resolvedCount > 0 && (
            <div className="insp-field">
              <span className="insp-field__label">Pixel area</span>
              <span className="insp-field__value">
                {(impact.estimatedPixelArea / 1_000_000).toFixed(1)} MP
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

      {scope?.mode === 'explicit-targets' && (
        <fieldset className="insp-field" aria-label="Explicit adjustment targets">
          <legend className="insp-field__label">Targets</legend>
          <div className="adjustment-scope__targets">
            {eligibleTargets.length === 0 ? (
              <span className="insp-field__hint">No eligible layers</span>
            ) : (
              eligibleTargets.map((target) => (
                <label key={target.id} className="adjustment-scope__target">
                  <input
                    type="checkbox"
                    checked={explicitTargetIds.has(target.id)}
                    onChange={() => toggleExplicitTarget(target.id)}
                    aria-label={`Apply adjustment to ${target.name}`}
                  />
                  <span>{target.name}</span>
                </label>
              ))
            )}
          </div>
        </fieldset>
      )}

      {/* Scope mode selector */}
      <div className="insp-field">
        <span className="insp-field__label">Change scope</span>
        <div className="insp-field__control">
          <Select
            label="Adjustment scope mode"
            value={scopeMode ?? ''}
            placeholder="Choose a scope…"
            options={SCOPE_MODE_OPTIONS}
            onChange={(v) => handleModeChange(v)}
          />
        </div>
      </div>

      {!scope && (
        <div className="insp-field insp-field--help">
          <span className="insp-field__value">
            No scope is set. Choose a mode to control which layers this adjustment affects.
          </span>
        </div>
      )}

      {/* Impact preview before a document-wide scope is committed. */}
      {pendingScope && pendingImpact && (
        <Dialog
          open
          onClose={cancelPendingScope}
          title="Adjustment Impact"
          footer={
            <>
              <Button variant="ghost" onClick={cancelPendingScope}>
                Cancel
              </Button>
              <Button variant="default" onClick={handleConfirmGlobal}>
                Apply
              </Button>
            </>
          }
        >
          <p>This adjustment will affect:</p>
          <ul className="adjustment-scope-impact__list">
            <li>{plural(pendingImpact.targetCount, 'target')}</li>
            <li>{plural(pendingImpact.affectedFrames, 'frame')}</li>
            <li>{plural(pendingImpact.affectedPages, 'page')}</li>
            <li>
              Estimated {(pendingImpact.estimatedPixelArea / 1_000_000).toFixed(1)} megapixels
              processed
            </li>
            <li>{plural(pendingImpact.activeAdjustmentCount, 'active adjustment')}</li>
          </ul>
        </Dialog>
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
