/**
 * EffectRow — modern card-style layer effect row with:
 * - Expand/collapse disclosure
 * - Visibility switch
 * - Direct inline blur radius editing for single-parameter blurs
 * - Circular color & tint swatches
 * - Dedicated configure trigger button
 * - Anchored focused parameter popover
 * - Stack actions menu (duplicate, reset, reorder, remove)
 */
import {
  canBeMatteSource,
  type Effect,
  type EffectMaskBinding,
  effectSupportsMask,
  layerEffectStage,
  type ManagedColor,
  removeEffectMask,
  setEffectMask,
} from '@varve/scene';
import {
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
  Icon,
  Menu,
  type MenuEntry,
  Select,
  Switch,
} from '@varve/ui';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../../context';
import { FieldRow, InspectorFieldGroup } from '../../controls/FieldRow';
import { InspectorColorPopover } from '../../controls/InspectorColorPopover';
import { InspectorFocusedEditor } from '../../controls/InspectorFocusedEditor';
import { NumberField } from '../../controls/NumberField';
import { commonValue, isMixed } from '../../selection/selectionState';
import {
  DepthBlurParams,
  SingleBlurParam,
  SpatialBlurParams,
  type SpatialBlurType,
} from './BlurParams';
import { ChromaticAberrationParams, GlitchParams } from './DistortionParams';
import {
  alignEffectRow,
  EFFECT_TYPE_OPTIONS,
  type EffectNode,
  getEffect,
  matchingEffectIndex,
  toSwatchBg,
} from './EffectTypes';
import { GlassMaterialParams } from './GlassMaterialParams';
import { GlowParams } from './GlowParams';
import { ShadowParams } from './ShadowParams';

export interface EffectRowProps {
  index: number;
  nodes: EffectNode[];
  onChange: (updater: (e: Effect) => Effect) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onReset: () => void;
  onReorder: (dir: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  startExpanded?: boolean;
}

function getEffectColor(e: Effect): ManagedColor | undefined {
  if (e.type === 'dropShadow' || e.type === 'innerShadow') return e.color;
  if (e.type === 'outerGlow' || e.type === 'innerGlow') return e.color;
  return undefined;
}

function setEffectColor(e: Effect, color: ManagedColor): Effect {
  if (e.type === 'dropShadow' || e.type === 'innerShadow') return { ...e, color };
  if (e.type === 'outerGlow' || e.type === 'innerGlow') return { ...e, color };
  return e;
}

export function EffectColorSwatch({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const { documentColorMode, beginTransaction, commitTransaction } = useEditor();
  const colorRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e) return getEffectColor(e);
    return { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 };
  });
  const color = isMixed(colorRaw) ? null : colorRaw;
  const swatchBg = color ? toSwatchBg(color) : 'transparent';

  return (
    <InspectorColorPopover
      label="Effect colour"
      className="insp-swatch insp-swatch--round"
      value={color ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 }}
      onChange={(c) => onChange((e) => setEffectColor(e, c as ManagedColor))}
      swatchStyle={{ background: swatchBg }}
      documentColorMode={documentColorMode}
      onEditStart={beginTransaction}
      onEditEnd={commitTransaction}
    />
  );
}

export function GlassTintSwatch({
  nodes,
  index,
  onChange,
}: {
  nodes: EffectNode[];
  index: number;
  onChange: (updater: (e: Effect) => Effect) => void;
}) {
  const { documentColorMode, beginTransaction, commitTransaction } = useEditor();
  const tintRaw = commonValue(nodes, (n) => {
    const e = getEffect(n, index);
    if (e && e.type === 'glassMaterial') return e.tint;
    return { space: 'rgb' as const, r: 200, g: 220, b: 255, a: 60 };
  });
  const tint = isMixed(tintRaw) ? null : tintRaw;
  const swatchBg = tint ? toSwatchBg(tint) : 'transparent';

  return (
    <InspectorColorPopover
      label="Glass tint"
      className="insp-swatch insp-swatch--round"
      value={tint ?? { space: 'rgb', r: 200, g: 220, b: 255, a: 60 }}
      onChange={(c) =>
        onChange((e) => (e.type === 'glassMaterial' ? { ...e, tint: c as ManagedColor } : e))
      }
      swatchStyle={{ background: swatchBg }}
      documentColorMode={documentColorMode}
      onEditStart={beginTransaction}
      onEditEnd={commitTransaction}
    />
  );
}

function effectIdFor(node: EffectNode, index: number): string {
  return node.effects?.[index]?.id ?? `fx-${node.id}-${index + 1}`;
}

export function EffectMaskControl({ nodes, index }: { nodes: EffectNode[]; index: number }) {
  const editor = useEditor();
  const document = editor.state?.document;
  const firstEffect = getEffect(nodes[0]!, index);
  const binding = firstEffect?.mask;
  const sourceId = binding?.source.kind === 'scene-node' ? binding.source.nodeId : '';
  const sourceCandidates = useMemo(() => {
    if (!document) return [];
    const selectedIds = new Set(nodes.map((node) => node.id));
    return Object.values(document.nodes)
      .filter((candidate) => !selectedIds.has(candidate.id) && canBeMatteSource(candidate))
      .map((candidate) => ({
        value: candidate.id,
        label: candidate.name ?? `${candidate.kind} ${candidate.id.slice(0, 6)}`,
      }));
  }, [document, nodes]);

  const updateBinding = useCallback(
    (next: EffectMaskBinding | null) => {
      if (!document) return;
      editor.beginTransaction();
      editor.updateDoc((doc) => {
        let nextDoc = doc;
        for (const node of nodes) {
          const currentIndex = matchingEffectIndex(
            node.effects ?? [],
            index,
            firstEffect,
            nodes[0]?.effects ?? [],
          );
          const current = currentIndex >= 0 ? node.effects?.[currentIndex] : undefined;
          if (!current) continue;
          const effectId = effectIdFor(node, currentIndex);
          if (!current.id) {
            nextDoc = {
              ...nextDoc,
              nodes: {
                ...nextDoc.nodes,
                [node.id]: {
                  ...nextDoc.nodes[node.id],
                  effects: (node.effects ?? []).map((effect, effectIndex) =>
                    effectIndex === currentIndex ? { ...effect, id: effectId } : effect,
                  ),
                } as EffectNode,
              },
            };
          }
          nextDoc = next
            ? setEffectMask(nextDoc, node.id, effectId, next)
            : removeEffectMask(nextDoc, node.id, effectId);
        }
        return nextDoc;
      });
      editor.commitTransaction();
      editor.announce(next ? 'Effect mask updated' : 'Effect mask removed');
    },
    [document, editor, firstEffect, index, nodes],
  );

  const selectSource = useCallback(
    (value: string) => {
      if (!value) {
        updateBinding(null);
        return;
      }
      updateBinding({
        source: { kind: 'scene-node', nodeId: value },
        type: binding?.type === 'luminance' ? 'luminance' : 'alpha',
        visible: binding?.visible !== false,
        inverted: binding?.inverted === true,
        density: binding?.density ?? 1,
        feather: binding?.feather ?? 0,
        linked: binding?.linked !== false,
        coordinateSpace: binding?.coordinateSpace ?? 'world',
      });
    },
    [binding, updateBinding],
  );

  const patchBinding = useCallback(
    (patch: Partial<EffectMaskBinding>) => {
      if (!binding) return;
      updateBinding({ ...binding, ...patch });
    },
    [binding, updateBinding],
  );

  return (
    <div className="insp-effect-params insp-effect-mask">
      <Select
        label="Effect mask source"
        value={sourceId}
        options={[
          { value: '', label: binding ? 'Remove effect mask' : 'No effect mask' },
          ...sourceCandidates,
        ]}
        onChange={selectSource}
      />
      {binding && (
        <Disclosure variant="compact" className="insp-effect-mask__settings">
          <DisclosureTrigger>Mask settings</DisclosureTrigger>
          <DisclosureContent>
            <FieldRow label="Mask type">
              <Select
                label="Effect mask type"
                value={binding.type}
                options={[
                  { value: 'alpha', label: 'Alpha' },
                  { value: 'luminance', label: 'Luminance' },
                  { value: 'clip', label: 'Clip' },
                ]}
                onChange={(value) => patchBinding({ type: value as EffectMaskBinding['type'] })}
              />
            </FieldRow>
            <InspectorFieldGroup columns={2}>
              <NumberField
                label="Density"
                value={binding.density ?? 1}
                min={0}
                max={1}
                step={0.05}
                onChange={(value) => patchBinding({ density: value })}
              />
              <NumberField
                label="Feather"
                value={binding.feather ?? 0}
                min={0}
                step={1}
                onChange={(value) => patchBinding({ feather: value })}
              />
            </InspectorFieldGroup>
            <InspectorFieldGroup columns={2}>
              <button
                type="button"
                className={`insp-toggle-btn${binding.inverted ? ' --active' : ''}`}
                aria-pressed={binding.inverted === true}
                onClick={() => patchBinding({ inverted: !binding.inverted })}
              >
                {binding.inverted ? 'Inverted' : 'Normal'}
              </button>
              <Select
                label="Effect mask coordinates"
                value={binding.coordinateSpace}
                options={[
                  { value: 'world', label: 'World' },
                  { value: 'target-local', label: 'Target local' },
                ]}
                onChange={(value) =>
                  patchBinding({ coordinateSpace: value as EffectMaskBinding['coordinateSpace'] })
                }
              />
            </InspectorFieldGroup>
          </DisclosureContent>
        </Disclosure>
      )}
    </div>
  );
}

export function EffectRow({
  index,
  nodes,
  onChange,
  onRemove,
  onDuplicate,
  onReset,
  onReorder,
  canMoveUp,
  canMoveDown,
  startExpanded = false,
}: EffectRowProps) {
  const editor = useEditor();
  const referenceStack = nodes[0]?.effects ?? [];
  const rowNodes = nodes.map((node) => alignEffectRow(node, index, referenceStack));
  const hasMissingEffect = rowNodes.some((node) => (node.effects?.length ?? 0) === 0);
  const typeRaw = commonValue(rowNodes, (n) => getEffect(n, index)?.type ?? 'dropShadow');
  const visibleRaw = commonValue(rowNodes, (n) => getEffect(n, index)?.visible ?? true);

  const type = isMixed(typeRaw) ? null : typeRaw;
  const visibility = isMixed(visibleRaw) ? true : visibleRaw;

  const typeLabel =
    type === null
      ? 'Mixed'
      : (EFFECT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type);
  const rowLabel = hasMissingEffect ? `${typeLabel} · Not on all selected layers` : typeLabel;

  const [expanded, setExpanded] = useState(startExpanded);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The focused editor is anchored to the disclosure trigger, not the row
  // card: a ref to an ancestor host node is still null when a descendant's
  // layout effect runs (refs attach post-order), and FloatingPortal resolves
  // its anchor once on mount.
  const chevronRef = useRef<HTMLButtonElement>(null);
  const paramsId = useId();
  const ownerKey = `${editor.state?.document?.id ?? 'document'}:${nodes.map((node) => node.id).join(',')}:${index}:${type ?? 'mixed'}`;

  const currentEffect = getEffect(nodes[0]!, index);
  const stage = currentEffect ? layerEffectStage(currentEffect) : 'appearance';

  const actionItems = useMemo<readonly MenuEntry[]>(
    () => [
      { id: 'reset', label: 'Reset effect', onAction: onReset, icon: 'RotateCcw' },
      { id: 'duplicate', label: 'Duplicate effect', onAction: onDuplicate, icon: 'Copy' },
      { id: 'separator-before-order', separator: true },
      {
        id: 'move-up',
        label: 'Move effect up',
        onAction: () => onReorder(-1),
        disabled: !canMoveUp,
        icon: 'ChevronUp',
      },
      {
        id: 'move-down',
        label: 'Move effect down',
        onAction: () => onReorder(1),
        disabled: !canMoveDown,
        icon: 'ChevronDown',
      },
      { id: 'separator-before-remove', separator: true },
      {
        id: 'remove',
        label: 'Remove effect',
        onAction: onRemove,
        destructive: true,
        icon: 'X',
      },
    ],
    [canMoveDown, canMoveUp, onDuplicate, onRemove, onReset, onReorder],
  );

  // In-row blur radius for single blurs
  const isSingleBlur = type === 'layerBlur' || type === 'backgroundBlur';
  const blurRadiusRaw = commonValue(rowNodes, (n) => {
    const e = getEffect(n, index);
    return e?.type === 'layerBlur' || e?.type === 'backgroundBlur' ? e.radius : 0;
  });

  const maskSupported = type ? effectSupportsMask({ type }) : false;
  const hasAuthoredMask = rowNodes.some((node) => Boolean(getEffect(node, index)?.mask));
  const maskControl = (
    <>
      {(maskSupported || hasAuthoredMask) && <EffectMaskControl nodes={rowNodes} index={index} />}
      {!maskSupported && (
        <p className="insp-effect-mask-note" role="note">
          {hasAuthoredMask
            ? 'This effect type ignores effect masks; the authored mask can be removed here.'
            : 'This effect type ignores effect masks.'}
        </p>
      )}
    </>
  );

  return (
    <div className={`insp-effect-row${expanded ? ' insp-effect-row--active' : ''}`}>
      <div className="insp-effect-row__header">
        {type && (
          <button
            ref={chevronRef}
            type="button"
            className="insp-disclosure__trigger"
            style={{ width: 'auto', padding: 0 }}
            aria-expanded={expanded}
            aria-controls={paramsId}
            aria-haspopup="dialog"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${rowLabel} parameters`}
            onClick={() => setExpanded((v) => !v)}
          >
            <Icon
              name="ChevronRight"
              label={undefined}
              className="insp-disclosure__chevron"
              size="0.85em"
            />
          </button>
        )}
        <Switch
          className="insp-switch"
          aria-label={`${visibility ? 'Hide' : 'Show'} effect`}
          checked={visibility}
          onChange={(event) => onChange((e) => ({ ...e, visible: event.target.checked }))}
        />
        {type &&
          type !== 'layerBlur' &&
          type !== 'gaussianBlur' &&
          type !== 'fieldBlur' &&
          type !== 'irisBlur' &&
          type !== 'tiltShiftBlur' &&
          type !== 'pathBlur' &&
          type !== 'spinBlur' &&
          type !== 'backgroundBlur' &&
          type !== 'glassMaterial' &&
          type !== 'chromaticAberration' &&
          type !== 'glitch' &&
          type !== 'depthBlur' && (
            <EffectColorSwatch nodes={rowNodes} index={index} onChange={onChange} />
          )}
        {type === 'glassMaterial' && (
          <GlassTintSwatch nodes={rowNodes} index={index} onChange={onChange} />
        )}
        {type && EFFECT_TYPE_OPTIONS.find((option) => option.value === type)?.icon && (
          <Icon
            name={EFFECT_TYPE_OPTIONS.find((option) => option.value === type)!.icon!}
            label={undefined}
            size="0.85em"
          />
        )}
        <span className="insp-effect-row__name">{rowLabel}</span>

        {/* In-row quick blur radius input */}
        {isSingleBlur && (
          <div className="insp-inrow-blur" title="Blur radius (px)">
            <input
              type="number"
              aria-label={`${rowLabel} radius`}
              className="insp-inrow-blur__input"
              value={isMixed(blurRadiusRaw) ? '' : blurRadiusRaw}
              min={0}
              max={4096}
              step={1}
              onChange={(e) => {
                const val = Math.max(0, Number(e.target.value) || 0);
                onChange((eff) =>
                  eff.type === 'layerBlur' || eff.type === 'backgroundBlur'
                    ? { ...eff, radius: val }
                    : eff,
                );
              }}
            />
            <span className="insp-inrow-blur__unit">px</span>
          </div>
        )}

        <button
          type="button"
          ref={triggerRef}
          className="insp-inline-btn insp-effect-row__menu-trigger"
          aria-label="Effect actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <Icon name="Ellipsis" label={undefined} size="0.85em" />
        </button>
        <Menu
          triggerRef={triggerRef}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          label={`${rowLabel} actions`}
          items={actionItems}
          size="compact"
        />
      </div>

      {type && expanded && (
        <InspectorFocusedEditor
          anchorRef={chevronRef}
          open={expanded}
          title={`${rowLabel} parameters`}
          badge={`${stage} stage`}
          ownerKey={ownerKey}
          onClose={() => setExpanded(false)}
        >
          <div id={paramsId} key={ownerKey}>
            {maskControl}
            {type === 'dropShadow' || type === 'innerShadow' ? (
              <ShadowParams nodes={rowNodes} index={index} onChange={onChange} />
            ) : type === 'outerGlow' || type === 'innerGlow' ? (
              <GlowParams nodes={rowNodes} index={index} onChange={onChange} />
            ) : type === 'layerBlur' || type === 'backgroundBlur' ? (
              <SingleBlurParam nodes={rowNodes} index={index} onChange={onChange} />
            ) : type === 'gaussianBlur' ||
              type === 'fieldBlur' ||
              type === 'irisBlur' ||
              type === 'tiltShiftBlur' ||
              type === 'pathBlur' ||
              type === 'spinBlur' ? (
              <SpatialBlurParams
                type={type as SpatialBlurType}
                nodes={rowNodes}
                index={index}
                onChange={onChange}
              />
            ) : type === 'depthBlur' ? (
              <DepthBlurParams nodes={rowNodes} index={index} onChange={onChange} />
            ) : type === 'glassMaterial' ? (
              <GlassMaterialParams nodes={rowNodes} index={index} onChange={onChange} />
            ) : type === 'chromaticAberration' ? (
              <ChromaticAberrationParams nodes={rowNodes} index={index} onChange={onChange} />
            ) : type === 'glitch' ? (
              <GlitchParams nodes={rowNodes} index={index} onChange={onChange} />
            ) : null}
          </div>
        </InspectorFocusedEditor>
      )}
    </div>
  );
}
