import type { Document, EffectStackKind, NodeId, SceneNode } from '@varve/scene';
import { activeSmartFilters, documentHasSolo } from '@varve/scene';
import { Popover, SOLID_CHROME_ICONS, SolidIcon } from '@varve/ui';
import type { ReactNode } from 'react';
import type { ParentIndexCache } from '../../scene/parentIndexCache';
import {
  hidingAncestorOf,
  isNodeEffectivelyHidden,
  isNodeEffectivelyLocked,
} from '../../scene/world';
import { layerAncestry, layerIdentity } from './layerDetails';
import {
  isComponentDefinition,
  isComponentInstance,
  layerAccessibleDescription,
  resolveLayerPresentation,
} from './layerPresentation';

export interface LayerDetailsPopoverProps {
  node: SceneNode;
  doc: Document;
  parentCache?: ParentIndexCache | null;
  maskRole?: 'source' | 'content';
  variantName?: string;
  syncStatus?: string;
  hasMotion?: boolean;
  onSelectAncestor?: (id: NodeId) => void;
  onOpenEffectStack?: (id: NodeId, kind: EffectStackKind) => void;
  onOpenAdjustment?: (id: NodeId) => void;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="layers-details__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function LayerDetailsPopover({
  node,
  doc,
  parentCache,
  maskRole,
  variantName,
  syncStatus,
  hasMotion = false,
  onSelectAncestor,
  onOpenEffectStack,
  onOpenAdjustment,
  children,
  open,
  onOpenChange,
}: LayerDetailsPopoverProps) {
  const presentation = resolveLayerPresentation(node, doc);
  const ancestry = layerAncestry(doc, node.id, parentCache);
  const identity = layerIdentity(node);
  const effectiveHidden = isNodeEffectivelyHidden(doc, node.id);
  const effectiveLocked = isNodeEffectivelyLocked(doc, node.id);
  const hiddenBy = hidingAncestorOf(doc, node.id);
  const mask = node.mask;
  const effects = 'effects' in node ? (node.effects?.length ?? 0) : 0;
  const objectFilters = node.smartFilters?.length ?? 0;
  const description = layerAccessibleDescription(node, presentation, {
    maskRole,
    detail: `${effectiveHidden ? 'hidden' : 'visible'}, ${effectiveLocked ? 'locked' : 'unlocked'}`,
  });

  return (
    <Popover
      placement="left"
      open={open}
      onOpenChange={onOpenChange}
      label={`Layer details for ${identity}`}
      popover={
        <div className="layers-details" data-layer-details>
          <div className="layers-details__heading">
            <SolidIcon name={SOLID_CHROME_ICONS.info} size={16} aria-hidden />
            <strong title={identity}>{identity}</strong>
          </div>
          <p className="layers-details__type">{description}</p>

          <section
            className="layers-details__section"
            aria-labelledby={`details-ancestry-${node.id}`}
          >
            <h3 id={`details-ancestry-${node.id}`}>Ancestry</h3>
            <nav aria-label={`Ancestry for ${identity}`} className="layers-details__ancestry">
              {ancestry.map((ancestor, index) => (
                <span key={ancestor.id} className="layers-details__ancestor">
                  {index > 0 && <span aria-hidden>›</span>}
                  <button
                    type="button"
                    onClick={() => onSelectAncestor?.(ancestor.id)}
                    disabled={!onSelectAncestor || ancestor.id === node.id}
                  >
                    {layerIdentity(ancestor)}
                  </button>
                </span>
              ))}
            </nav>
          </section>

          <dl className="layers-details__facts">
            <DetailRow label="Visibility" value={effectiveHidden ? 'Hidden' : 'Visible'} />
            {hiddenBy && hiddenBy !== node.id && (
              <DetailRow
                label="Inherited from"
                value={layerIdentity(doc.nodes[hiddenBy] ?? node)}
              />
            )}
            <DetailRow label="Lock" value={effectiveLocked ? 'Locked' : 'Unlocked'} />
            {mask && (
              <DetailRow
                label="Mask"
                value={`${mask.type} mask${mask.visible === false ? ' (disabled)' : ''}`}
              />
            )}
            {maskRole && (
              <DetailRow
                label="Mask role"
                value={maskRole === 'source' ? 'Source' : 'Clipped content'}
              />
            )}
            {isComponentDefinition(node, doc) && <DetailRow label="Component" value="Definition" />}
            {isComponentInstance(node) && (
              <DetailRow
                label="Component"
                value={`Instance${variantName ? ` · ${variantName}` : ''}`}
              />
            )}
            {isComponentInstance(node) && syncStatus && (
              <DetailRow label="Sync" value={syncStatus} />
            )}
            {effects > 0 && <DetailRow label="Layer effects" value={`${effects}`} />}
            {objectFilters > 0 && (
              <DetailRow
                label="Object filters"
                value={`${activeSmartFilters(node).length}/${objectFilters} enabled`}
              />
            )}
            {hasMotion && <DetailRow label="Motion" value="Animated" />}
            {documentHasSolo(doc) && (
              <DetailRow label="Isolation" value={node.solo ? 'Soloed' : 'Dimmed by solo'} />
            )}
          </dl>

          {(effects > 0 || objectFilters > 0 || node.kind === 'adjustment') && (
            <div className="layers-details__actions">
              {effects > 0 && onOpenEffectStack && (
                <button type="button" onClick={() => onOpenEffectStack(node.id, 'layer-effects')}>
                  Open effects
                </button>
              )}
              {objectFilters > 0 && onOpenEffectStack && (
                <button type="button" onClick={() => onOpenEffectStack(node.id, 'object-filters')}>
                  Open filters
                </button>
              )}
              {node.kind === 'adjustment' && onOpenAdjustment && (
                <button type="button" onClick={() => onOpenAdjustment(node.id)}>
                  Open adjustment
                </button>
              )}
            </div>
          )}
        </div>
      }
    >
      {children}
    </Popover>
  );
}
