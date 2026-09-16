import type { MaskType, SceneNode } from '@varve/scene';
import {
  canBeClipMaskSource,
  canReceiveLayerMask,
  canReceiveRasterMask,
  isVisualMaskTarget,
  walkNodes,
} from '@varve/scene';
import { Icon, Select, Switch, Tooltip } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { RangeValueControl } from '../controls/RangeValueControl';
import type { SectionId } from '../sectionRegistry';
import { isSectionCollapsed } from '../sectionState';

export function MaskSection({ nodes, sectionId }: { nodes: SceneNode[]; sectionId?: SectionId }) {
  const editor = useEditor();
  const {
    addMaskToSelected,
    removeMaskFromSelected,
    toggleMask,
    invertMask,
    setMaskFeather,
    setMaskDensity,
    setMaskHideSource,
    setMaskLinked,
    setMaskType,
    setMaskFillRule,
    setMaskVectorPath,
    setMaskSourceNode,
    setTool,
    state,
  } = editor;

  const node = nodes[0]!;
  const document = state.document;
  const container = node as SceneNode & { mask?: unknown; children?: string[] };
  const mask = (container.mask ?? null) as {
    type: MaskType;
    visible: boolean;
    inverted?: boolean;
    hideMaskSource?: boolean;
    feather?: number;
    density?: number;
    sourceNodeId?: string;
    linked?: boolean;
    fillRule?: 'nonzero' | 'evenodd';
    vectorMask?: {
      points: {
        x: number;
        y: number;
        handleIn?: { x: number; y: number } | null;
        handleOut?: { x: number; y: number } | null;
      }[];
      closed: boolean;
      fillRule: 'nonzero' | 'evenodd';
    };
    rasterMask?: {
      coordinateSpace?:
        | 'source-image-pixels'
        | 'legacy-preview-pixels'
        | 'container-local-pixels'
        | 'node-local-pixels';
    };
  } | null;

  const isVisualLeaf = isVisualMaskTarget(node);
  const canHaveMask = canReceiveLayerMask(node);
  const hasChildren = 'children' in container && (container.children?.length ?? 0) > 0;
  // Leaf nodes can add vector masks (no child source needed); containers need
  // children or adjustment kind for structural mask sources.
  const canAddMask =
    canHaveMask && !mask && (hasChildren || node.kind === 'adjustment' || isVisualLeaf);
  const canPaintRasterMask =
    canReceiveRasterMask(node, mask?.rasterMask?.coordinateSpace) &&
    (!mask || Boolean(mask.rasterMask));

  const nodeMap = useMemo(() => {
    if (!document || !mask?.sourceNodeId) return null;
    return walkNodes(document);
  }, [document, mask?.sourceNodeId]);

  const sourceNode = useMemo(() => {
    if (!mask?.sourceNodeId || !nodeMap) return null;
    const entry = nodeMap.get(mask.sourceNodeId);
    return entry?.node ?? null;
  }, [mask?.sourceNodeId, nodeMap]);

  // Mask sources must be direct children (frame/group) of the container —
  // the picker only offers the valid set instead of free node selection.
  const sourceCandidates = useMemo(() => {
    if (!document) return [];
    const candidateIds =
      node.kind === 'adjustment'
        ? Object.keys(document.nodes)
        : 'children' in container && container.children
          ? container.children
          : [];
    return candidateIds
      .map((id) => document.nodes[id])
      .filter((candidate): candidate is SceneNode => {
        if (!candidate || candidate.id === node.id || candidate.kind === 'adjustment') return false;
        return mask?.type === 'clip' ? canBeClipMaskSource(candidate) : true;
      })
      .map((candidate) => ({
        value: candidate.id,
        label: candidate.name ?? `${candidate.kind} ${candidate.id.slice(0, 6)}`,
      }));
  }, [document, container, mask?.type, node.id, node.kind]);

  const [pendingSourceId, setPendingSourceId] = useState('');

  const maskTypeLabel = useMemo(() => {
    if (!mask) return '';
    const labels: Record<string, string> = {
      clip: 'Clip',
      alpha: 'Alpha',
      luminance: 'Luminance',
    };
    return labels[mask.type] ?? mask.type;
  }, [mask]);

  const handleToggleVisible = useCallback(() => {
    toggleMask();
    editor.announce(mask?.visible === false ? 'Mask shown' : 'Mask hidden');
  }, [toggleMask, editor, mask?.visible]);

  const handleToggleInverted = useCallback(() => {
    invertMask();
    editor.announce('Mask inverted');
  }, [invertMask, editor]);

  const handleRemove = useCallback(() => {
    removeMaskFromSelected();
    editor.announce('Mask removed');
  }, [removeMaskFromSelected, editor]);

  const handleFeather = useCallback(
    (v: number) => {
      setMaskFeather(Math.max(0, v));
    },
    [setMaskFeather],
  );

  const handleDensity = useCallback(
    (v: number) => {
      setMaskDensity(Math.max(0, Math.min(1, v)));
    },
    [setMaskDensity],
  );

  const handleToggleHideSource = useCallback(() => {
    if (setMaskHideSource) {
      setMaskHideSource(!mask?.hideMaskSource);
      editor.announce(mask?.hideMaskSource ? 'Mask source shown' : 'Mask source hidden');
    }
  }, [setMaskHideSource, mask?.hideMaskSource, editor]);

  const handleToggleLinked = useCallback(() => {
    if (setMaskLinked) {
      setMaskLinked(!mask?.linked);
      editor.announce(mask?.linked ? 'Mask unlinked' : 'Mask linked');
    }
  }, [setMaskLinked, mask?.linked, editor]);

  const handleTypeChange = useCallback(
    (v: string) => {
      if (setMaskType) {
        setMaskType(v as MaskType);
      }
    },
    [setMaskType],
  );

  const handleSetFillRule = useCallback(
    (rule: 'nonzero' | 'evenodd') => {
      if (setMaskFillRule) {
        setMaskFillRule(rule);
      }
    },
    [setMaskFillRule],
  );

  const handleEditVectorPath = useCallback(() => {
    if (setMaskVectorPath && mask?.vectorMask) {
      setMaskVectorPath(
        mask.vectorMask.points as import('@varve/engine').PathPoint[],
        mask.vectorMask.closed,
      );
    }
  }, [setMaskVectorPath, mask?.vectorMask]);

  const supportsFillRule = mask?.type === 'clip' || mask?.vectorMask;

  if (!canHaveMask) return null;

  const sourceLabel = sourceNode?.name ?? mask?.sourceNodeId?.slice(0, 8) ?? 'none';
  // When the section is collapsed, the header still has to say a mask is
  // active — otherwise an enabled mask is invisible until the user expands it.
  const collapsed = isSectionCollapsed(state.sectionVisibility, sectionId ?? 'mask');

  return (
    <DisclosureSection
      title="Mask"
      sectionId={sectionId ?? 'mask'}
      action={
        mask && collapsed ? (
          <span
            className={`insp-mask-header-badge${mask.visible ? '' : ' insp-mask-header-badge--off'}`}
          >
            {maskTypeLabel}
          </span>
        ) : undefined
      }
    >
      {canAddMask && (
        <div className="insp-mask-add">
          {node.kind === 'adjustment' && sourceCandidates.length > 0 && (
            <Select
              label="Spatial mask source"
              value={pendingSourceId}
              options={sourceCandidates}
              placeholder="Choose a mask source"
              onChange={setPendingSourceId}
            />
          )}
          <div className="insp-mask-add__actions" role="group" aria-label="Add Mask">
            {isVisualLeaf ? (
              <Tooltip label="Editable vector path that clips this layer">
                <button
                  type="button"
                  className="insp-btn-sm"
                  onClick={() => addMaskToSelected('alpha')}
                  aria-label="Add vector mask"
                >
                  <Icon name="PenTool" size="0.85em" />
                  <span>Vector mask</span>
                </button>
              </Tooltip>
            ) : (
              <>
                <Tooltip label="Uses the first child's outline to clip the others">
                  <button
                    type="button"
                    className="insp-btn-sm"
                    onClick={() => addMaskToSelected('clip', pendingSourceId || undefined)}
                    aria-label="Add clip mask"
                    disabled={node.kind === 'adjustment' && !pendingSourceId}
                  >
                    <Icon name="SquareDashed" size="0.85em" />
                    <span>Clip</span>
                  </button>
                </Tooltip>
                <Tooltip label="Uses the first child's alpha channel to modulate visibility">
                  <button
                    type="button"
                    className="insp-btn-sm"
                    onClick={() => addMaskToSelected('alpha', pendingSourceId || undefined)}
                    aria-label="Add alpha mask"
                    disabled={node.kind === 'adjustment' && !pendingSourceId}
                  >
                    <Icon name="CircleDashed" size="0.85em" />
                    <span>Alpha</span>
                  </button>
                </Tooltip>
                <Tooltip label="Uses the first child's luminance to modulate visibility">
                  <button
                    type="button"
                    className="insp-btn-sm"
                    onClick={() => addMaskToSelected('luminance', pendingSourceId || undefined)}
                    aria-label="Add luminance mask"
                    disabled={node.kind === 'adjustment' && !pendingSourceId}
                  >
                    <Icon name="Contrast" size="0.85em" />
                    <span>Luminance</span>
                  </button>
                </Tooltip>
              </>
            )}
            {canPaintRasterMask && (
              <Tooltip label="Paints a pixel alpha mask over this layer. Paint reveals, Alt+paint hides.">
                <button
                  type="button"
                  className="insp-btn-sm"
                  onClick={() => {
                    setTool?.('refineMask');
                  }}
                  aria-label="Paint mask with the brush tool"
                >
                  <Icon name="Paintbrush" size="0.85em" />
                  <span>{mask?.rasterMask ? 'Paint mask…' : 'Brush mask…'}</span>
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      )}

      {mask && (
        <div className="insp-mask-card">
          <div className="insp-mask-card__header">
            <span className="insp-mask-card__title">
              <Icon name="Layers2" size="0.85em" />
              {maskTypeLabel} mask
            </span>
            <div className="insp-mask-card__actions">
              <Tooltip label={mask.visible ? 'Mask is active' : 'Mask is disabled'}>
                <button
                  type="button"
                  className={`insp-icon-btn ${mask.visible ? 'insp-icon-btn--active' : ''}`}
                  onClick={handleToggleVisible}
                  aria-label={mask.visible ? 'Disable mask' : 'Enable mask'}
                  aria-pressed={mask.visible}
                >
                  <Icon name={mask.visible ? 'Eye' : 'EyeOff'} size="0.9em" />
                </button>
              </Tooltip>
              <Tooltip label={mask.inverted ? 'Mask is inverted' : 'Mask is not inverted'}>
                <button
                  type="button"
                  className={`insp-icon-btn ${mask.inverted ? 'insp-icon-btn--active' : ''}`}
                  onClick={handleToggleInverted}
                  aria-label={mask.inverted ? 'Disable inversion' : 'Enable inversion'}
                  aria-pressed={mask.inverted ?? false}
                >
                  <Icon name="Contrast" size="0.9em" />
                </button>
              </Tooltip>
              <Tooltip label="Remove mask (source node is preserved)">
                <button
                  type="button"
                  className="insp-icon-btn insp-icon-btn--danger"
                  onClick={handleRemove}
                  aria-label="Remove mask"
                >
                  <Icon name="Trash2" size="0.9em" />
                </button>
              </Tooltip>
            </div>
          </div>

          <FieldRow label="Type">
            <Select
              label="Mask type"
              value={mask.type}
              options={[
                { value: 'clip', label: 'Clip' },
                { value: 'alpha', label: 'Alpha' },
                { value: 'luminance', label: 'Luminance' },
              ]}
              onChange={handleTypeChange}
            />
          </FieldRow>

          {sourceCandidates.length > 0 ? (
            <Select
              label="Mask source"
              value={mask?.sourceNodeId ?? ''}
              options={sourceCandidates}
              placeholder="Select a child as mask source"
              onChange={(v) => {
                if (setMaskSourceNode && v) {
                  setMaskSourceNode(v);
                  editor.announce('Mask source updated');
                }
              }}
            />
          ) : (
            <FieldRow label="Source">
              <span className="insp-mask-card__source-name">{sourceLabel}</span>
            </FieldRow>
          )}

          {mask.sourceNodeId && (
            <>
              <FieldRow label="Hide source">
                <Switch
                  aria-label={mask.hideMaskSource ? 'Show mask source' : 'Hide mask source'}
                  checked={mask.hideMaskSource ?? false}
                  onChange={handleToggleHideSource}
                />
              </FieldRow>
              <FieldRow label="Link transform">
                <Switch
                  aria-label={
                    mask.linked !== false ? 'Unlink mask transform' : 'Link mask transform'
                  }
                  checked={mask.linked !== false}
                  onChange={handleToggleLinked}
                />
              </FieldRow>
            </>
          )}

          <NumberField
            label="Feather"
            value={mask.feather ?? 0}
            min={0}
            step={0.5}
            onChange={handleFeather}
            fieldName="maskFeather"
          />

          <FieldRow label="Density" htmlFor="mask-density-range">
            <RangeValueControl
              id="mask-density"
              label="Density"
              value={mask.density ?? 1}
              min={0}
              max={1}
              step={0.05}
              displayScale={100}
              unit="%"
              rangeClassName="insp-range"
              rangeAriaLabel="Mask density"
              onChange={handleDensity}
            />
          </FieldRow>

          {supportsFillRule && (
            <FieldRow label="Fill rule">
              <div className="insp-segmented" role="group" aria-label="Fill rule">
                <Tooltip label="Nonzero winding rule: determines interior by winding direction">
                  <button
                    type="button"
                    className={`insp-segmented__btn ${mask.fillRule !== 'evenodd' ? 'insp-segmented__btn--active' : ''}`}
                    onClick={() => handleSetFillRule('nonzero')}
                    aria-pressed={mask.fillRule !== 'evenodd'}
                    aria-label="Nonzero fill rule"
                  >
                    Nonzero
                  </button>
                </Tooltip>
                <Tooltip label="Even-odd rule: determines interior by raycast parity">
                  <button
                    type="button"
                    className={`insp-segmented__btn ${mask.fillRule === 'evenodd' ? 'insp-segmented__btn--active' : ''}`}
                    onClick={() => handleSetFillRule('evenodd')}
                    aria-pressed={mask.fillRule === 'evenodd'}
                    aria-label="Even-odd fill rule"
                  >
                    Even-Odd
                  </button>
                </Tooltip>
              </div>
            </FieldRow>
          )}

          {mask.vectorMask && (
            <FieldRow label="Vector path">
              <span className="insp-mask-card__source-name">
                {mask.vectorMask.points.length} pt
                {mask.vectorMask.points.length !== 1 ? 's' : ''}
                {mask.vectorMask.closed ? ' · closed' : ' · open'}
              </span>
              <Tooltip label="Edit the vector mask path points">
                <button
                  type="button"
                  className="insp-btn-sm"
                  onClick={handleEditVectorPath}
                  aria-label="Edit vector mask path"
                >
                  <Icon name="Spline" size="0.85em" />
                  <span>Edit path</span>
                </button>
              </Tooltip>
            </FieldRow>
          )}

          {mask.type === 'clip' && (
            <p className="insp-field__hint">
              Feather blurs the clip boundary; density reduces the mask's strength.
            </p>
          )}
        </div>
      )}
    </DisclosureSection>
  );
}
