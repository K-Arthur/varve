/**
 * EffectsSection — stacked layer-effect controls (shadows, glows, blurs, and procedural effects).
 *
 * Multi-select: matches effects by stable identity when available, with a
 * type-checked index fallback for legacy stacks. Property edits batch across
 * all selected nodes in one undo step.
 *
 * Research basis: Figma / Sketch / Penpot effects panels, APG Disclosure pattern,
 * Elevation Presets & 2D Light Direction controller.
 */
import type { Effect, SceneNode } from '@varve/scene';
import {
  cloneEffects,
  createDefaultEffect,
  layerEffectMoveTarget,
  layerEffectStage,
} from '@varve/scene';
import {
  Icon,
  Menu,
  type MenuEntry,
  Sortable,
  type SortableEndResult,
  SortableItem,
  SortableOverlay,
} from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { EffectRow } from './effects/EffectRow';
import {
  EFFECT_CATEGORIES,
  EFFECT_TYPE_OPTIONS,
  type EffectNode,
  hasEffects,
  matchingEffectIndex,
} from './effects/EffectTypes';

import './effects/effects.css';

export interface EffectsSectionProps {
  nodes: SceneNode[];
  /** Link the disclosure to centralized Inspector state when hosted there. */
  sectionId?: 'effects';
}

export function EffectsSection({ nodes, sectionId }: EffectsSectionProps) {
  const { updateNode, beginTransaction, commitTransaction, abortTransaction, announce } =
    useEditor();
  const [newEffectType, setNewEffectType] = useState<Effect['type']>('dropShadow');
  // Effect just added via the picker below — that row should mount expanded
  // (ready to configure) instead of collapsed like the rest of the stack.
  const [lastAddedIndex, setLastAddedIndex] = useState<number | null>(null);
  const reorderActiveRef = useRef(false);

  const effectNodes = useMemo(() => nodes.filter(hasEffects), [nodes]);
  const referenceEffects = useMemo(
    () => effectNodes.find((node) => (node.effects?.length ?? 0) > 0)?.effects ?? [],
    [effectNodes],
  );

  const batchUpdate = useCallback(
    (updater: (effects: Effect[]) => Effect[]) => {
      beginTransaction();
      for (const node of effectNodes) {
        updateNode(node.id, (n) => {
          const sn = n as EffectNode;
          return { ...n, effects: updater(sn.effects ?? []) };
        });
      }
      commitTransaction();
    },
    [effectNodes, updateNode, beginTransaction, commitTransaction],
  );

  const updateEffect = useCallback(
    (index: number, updater: (e: Effect) => Effect) => {
      const reference = referenceEffects[index];
      batchUpdate((effects) => {
        const next = [...effects];
        const targetIndex = matchingEffectIndex(effects, index, reference, referenceEffects);
        if (targetIndex >= 0) {
          next[targetIndex] = updater(next[targetIndex] as Effect);
        }
        return next;
      });
    },
    [batchUpdate, effectNodes, referenceEffects],
  );

  const addEffect = useCallback(() => {
    if (newEffectType === 'depthBlur') {
      announce('Generate a DepthMap in the image Depth Blur section before adding Depth Blur');
      return;
    }
    if (effectNodes.length > 0) {
      setLastAddedIndex(Math.min(...effectNodes.map((n) => n.effects?.length ?? 0)));
    }
    batchUpdate((effects) => [...effects, createDefaultEffect(newEffectType)]);
    announce('Effect added');
  }, [newEffectType, batchUpdate, announce, effectNodes]);

  const removeEffect = useCallback(
    (index: number) => {
      const reference = referenceEffects[index];
      batchUpdate((effects) => {
        const targetIndex = matchingEffectIndex(effects, index, reference, referenceEffects);
        return targetIndex >= 0 ? effects.filter((_, i) => i !== targetIndex) : effects;
      });
      announce('Effect removed');
    },
    [batchUpdate, announce, effectNodes, referenceEffects],
  );

  const duplicateEffect = useCallback(
    (index: number) => {
      setLastAddedIndex(index + 1);
      const reference = referenceEffects[index];
      batchUpdate((effects) => {
        const targetIndex = matchingEffectIndex(effects, index, reference, referenceEffects);
        const source = targetIndex >= 0 ? effects[targetIndex] : undefined;
        if (!source || targetIndex < 0) return effects;
        const next = [...effects];
        const copied = cloneEffects([source])[0];
        if (!copied) return effects;
        next.splice(targetIndex + 1, 0, copied);
        return next;
      });
      announce('Effect duplicated');
    },
    [batchUpdate, announce, effectNodes, referenceEffects],
  );

  const resetEffect = useCallback(
    (index: number) => {
      updateEffect(index, (effect) => {
        const reset = createDefaultEffect(effect.type, effect.id);
        return effect.mask ? { ...reset, mask: effect.mask } : reset;
      });
      announce('Effect reset');
    },
    [updateEffect, announce],
  );

  const applyEffectReorder = useCallback(
    (from: number, to: number) => {
      const sourceReference = referenceEffects[from];
      const targetReference = referenceEffects[to];
      if (!sourceReference || !targetReference) return false;
      if (layerEffectStage(sourceReference) !== layerEffectStage(targetReference)) return false;
      for (const node of effectNodes) {
        updateNode(node.id, (current) => {
          const effects = (current as EffectNode).effects ?? [];
          const sourceIndex = matchingEffectIndex(effects, from, sourceReference, referenceEffects);
          const targetIndex = matchingEffectIndex(effects, to, targetReference, referenceEffects);
          if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return current;
          const next = [...effects];
          const [item] = next.splice(sourceIndex, 1);
          if (item) next.splice(targetIndex, 0, item);
          return { ...current, effects: next };
        });
      }
      return true;
    },
    [effectNodes, referenceEffects, updateNode],
  );

  const reorderEffect = useCallback(
    (from: number, direction: -1 | 1) => {
      const target = layerEffectMoveTarget(referenceEffects, from, direction);
      if (target < 0) return;
      beginTransaction();
      applyEffectReorder(from, target);
      commitTransaction();
    },
    [applyEffectReorder, beginTransaction, commitTransaction, referenceEffects],
  );

  if (effectNodes.length === 0) return null;

  const rowCount = referenceEffects.length;
  const countMixed = !effectNodes.every((n) => (n.effects?.length ?? 0) === rowCount);
  const effectSortIds = useMemo(
    () => Array.from({ length: rowCount }, (_, index) => `effect-${index}`),
    [rowCount],
  );

  const finishReorder = useCallback(
    (cancel: boolean) => {
      if (!reorderActiveRef.current) return;
      reorderActiveRef.current = false;
      if (cancel) abortTransaction();
      else commitTransaction();
    },
    [abortTransaction, commitTransaction],
  );

  const startReorder = useCallback(() => {
    if (reorderActiveRef.current) return;
    reorderActiveRef.current = true;
    beginTransaction();
  }, [beginTransaction]);

  const handleEffectReorder = useCallback(
    ({ event, items }: SortableEndResult) => {
      if (!items) {
        finishReorder(true);
        return;
      }
      const activeId = String(event.active.id);
      const from = effectSortIds.indexOf(activeId);
      const to = items.map(String).indexOf(activeId);
      if (from >= 0 && to >= 0 && from !== to) {
        const moved = applyEffectReorder(from, to);
        announce(
          moved
            ? `Moved ${from === 0 ? 'effect' : `effect ${from + 1}`} to position ${to + 1}`
            : 'Effects can be reordered within their processing stage',
        );
      }
      finishReorder(false);
    },
    [announce, applyEffectReorder, effectSortIds, finishReorder],
  );

  useEffect(
    () => () => {
      if (reorderActiveRef.current) {
        reorderActiveRef.current = false;
        commitTransaction();
      }
    },
    [commitTransaction],
  );

  return (
    <DisclosureSection
      title="Layer Effects"
      sectionId={sectionId}
      action={
        <EffectAddAction value={newEffectType} onChange={setNewEffectType} onAdd={addEffect} />
      }
    >
      {effectNodes.every((n) => (n.effects?.length ?? 0) === 0) ? (
        <div className="insp-empty-message">No effects</div>
      ) : (
        <Sortable
          items={effectSortIds}
          layout="vertical"
          onDragStart={startReorder}
          onDragCancel={() => finishReorder(true)}
          onReorder={handleEffectReorder}
          renderOverlay={(id) => {
            const index = effectSortIds.indexOf(String(id));
            return (
              <SortableOverlay className="insp-paint-stack__drag-overlay">
                {index >= 0 ? (index === 0 ? 'Effect' : `Effect ${index + 1}`) : 'Effect'}
              </SortableOverlay>
            );
          }}
        >
          {Array.from({ length: rowCount }, (_, i) => {
            return (
              <SortableItem
                key={effectSortIds[i]}
                id={effectSortIds[i]!}
                className="insp-paint-stack__sortable-item"
                data={{ type: 'effect', index: i }}
              >
                <EffectRow
                  index={i}
                  totalEffects={rowCount}
                  nodes={effectNodes}
                  onChange={(updater) => updateEffect(i, updater)}
                  onRemove={() => removeEffect(i)}
                  onDuplicate={() => duplicateEffect(i)}
                  onReset={() => resetEffect(i)}
                  onReorder={(dir: number) => reorderEffect(i, dir as -1 | 1)}
                  canMoveUp={layerEffectMoveTarget(referenceEffects, i, -1) >= 0}
                  canMoveDown={layerEffectMoveTarget(referenceEffects, i, 1) >= 0}
                  startExpanded={i === lastAddedIndex}
                />
              </SortableItem>
            );
          })}
        </Sortable>
      )}
      {countMixed && rowCount > 0 && (
        <div className="insp-empty-message">Some selected nodes have additional effects</div>
      )}
    </DisclosureSection>
  );
}

function EffectAddAction({
  value,
  onChange,
  onAdd,
}: {
  value: Effect['type'];
  onChange: (value: Effect['type']) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedLabel =
    EFFECT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? 'Effect type';

  const menuItems = useMemo<readonly MenuEntry[]>(() => {
    const items: MenuEntry[] = [];
    EFFECT_CATEGORIES.forEach((category, catIndex) => {
      if (catIndex > 0) {
        items.push({ id: `sep-${category.id}`, separator: true });
      }
      items.push({ id: `label-${category.id}`, type: 'label', label: category.label });
      category.options.forEach((option) => {
        items.push({
          id: option.value,
          label: option.label,
          icon: option.icon,
          disabled: option.disabled || option.value === 'depthBlur',
          onAction: () => {
            onChange(option.value);
            setOpen(false);
          },
        });
      });
    });
    return items;
  }, [onChange]);

  return (
    <div className="insp-fill-add__controls">
      <button
        ref={triggerRef}
        type="button"
        className="insp-inline-btn insp-effect-type-trigger"
        aria-label="New effect type"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Effect type: ${selectedLabel}`}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon
          name={EFFECT_TYPE_OPTIONS.find((option) => option.value === value)?.icon ?? 'Sparkles'}
          label={undefined}
          size="0.85em"
        />
        <Icon name="ChevronDown" label={undefined} size="0.75em" />
      </button>
      <Menu
        triggerRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        label="New effect type"
        items={menuItems}
        size="compact"
      />
      <button
        type="button"
        className="insp-add-btn"
        onClick={onAdd}
        disabled={value === 'depthBlur'}
        title={
          value === 'depthBlur'
            ? 'Generate a DepthMap in the image Depth Blur section first'
            : `Add ${selectedLabel}`
        }
      >
        <Icon name="Plus" label={undefined} size="0.85em" />
        <span>Add</span>
      </button>
    </div>
  );
}
