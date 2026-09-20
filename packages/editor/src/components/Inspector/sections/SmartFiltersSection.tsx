/**
 * Object Filters — object-local, nondestructive filter stack editor.
 *
 * The stack is stored on the selected scene node. This section intentionally
 * shares AdjustmentEditor with adjustment layers so new filter kinds only need
 * one parameter editor and one engine FilterIR implementation.
 */
import type { Adjustment, AdjustmentBlendMode, AdjustmentKind } from '@varve/engine';
import {
  filterKindDisplayName,
  getEffectStudioTreatment,
  isKnownAdjustmentKind,
} from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import {
  canHaveSmartFilters,
  cloneSmartFilters,
  cryptoId,
  isImageShape,
  makeSmartFilter,
} from '@varve/scene';
import {
  Select,
  SOLID_CHROME_ICONS,
  SolidIcon,
  Sortable,
  SortableItem,
  SortableItemHandle,
  SortableOverlay,
} from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { AdjustmentEditor } from '../../AdjustmentLayer/AdjustmentEditor';
import { groupBlendOptions } from '../controls/blendModeOptionGroups';
import { DisclosureSection } from '../controls/DisclosureSection';
import { InspectorFocusedEditor } from '../controls/InspectorFocusedEditor';
import { RangeValueControl } from '../controls/RangeValueControl';
import { blendModeDisplayName, filterKindIcon, SMART_FILTER_GROUPS } from './smartFilterCatalog';
import {
  type VectorFinishingKind,
  VectorFinishingQuickActions,
} from './VectorFinishingQuickActions';
import './smartFilters.css';

export interface SmartFiltersSectionProps {
  nodes: SceneNode[];
}

const BLEND_OPTIONS: { value: AdjustmentBlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'darken', label: 'Darken' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'colorBurn', label: 'Color Burn' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'screen', label: 'Screen' },
  { value: 'colorDodge', label: 'Color Dodge' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'softLight', label: 'Soft Light' },
  { value: 'hardLight', label: 'Hard Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

function filterName(filter: Adjustment): string {
  return isKnownAdjustmentKind(filter.kind)
    ? filterKindDisplayName(filter.kind)
    : `Unavailable effect (${String(filter.kind)})`;
}

function studioTreatmentName(filter: Adjustment): string | undefined {
  const treatmentId = filter.studioTreatment?.treatmentId;
  return treatmentId ? getEffectStudioTreatment(treatmentId)?.name : undefined;
}

function markTreatmentCustomized(filters: readonly Adjustment[], filterId: string): Adjustment[] {
  const source = filters.find((filter) => filter.id === filterId);
  const metadata = source?.studioTreatment;
  if (!metadata) return [...filters];
  return filters.map((filter) => {
    const member = filter.studioTreatment;
    if (member?.treatmentId !== metadata.treatmentId || member.instanceId !== metadata.instanceId) {
      return filter;
    }
    return {
      ...filter,
      studioTreatment: { ...member, customized: true },
    } as Adjustment;
  });
}

export function SmartFiltersSection({ nodes }: SmartFiltersSectionProps) {
  const { updateNode, beginTransaction, commitTransaction, abortTransaction, announce } =
    useEditor();
  const node = nodes.length === 1 ? nodes[0] : undefined;
  const nodeId = node?.id;
  const compatible = node ? canHaveSmartFilters(node) : false;
  const filters = compatible && node ? (node.smartFilters ?? []) : [];
  const stackEnabled = node?.smartFiltersEnabled !== false;
  const hasVectorFinishing = !!node && !isImageShape(node);
  const hasCuratedRecipeMembers = filters.some((filter) => filter.studioTreatment);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(() => !hasCuratedRecipeMembers);
  const editingRef = useRef(false);
  // Anchor for the focused parameter editor. The editor is portaled beside the
  // row instead of expanding inline, so the stack stays scannable and the
  // canvas keeps its width.
  const editorAnchorRef = useRef<HTMLButtonElement>(null);

  const finishTransaction = useCallback(() => {
    if (!editingRef.current) return;
    editingRef.current = false;
    commitTransaction();
  }, [commitTransaction]);

  const cancelTransaction = useCallback(() => {
    if (!editingRef.current) return;
    editingRef.current = false;
    abortTransaction();
  }, [abortTransaction]);

  const startTransaction = useCallback(() => {
    if (editingRef.current) return;
    editingRef.current = true;
    beginTransaction();
  }, [beginTransaction]);

  useEffect(() => {
    // A removed filter closes its editor; a newly added one opens it (addFilter
    // sets selectedId). Never auto-open on section mount: the popover is an
    // explicit request, not a side effect of selecting a layer.
    if (selectedId && !filters.some((filter) => filter.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filters, selectedId]);

  useEffect(() => {
    setAdvancedOpen(!hasCuratedRecipeMembers);
  }, [hasCuratedRecipeMembers, nodeId]);

  useEffect(
    () => () => {
      if (editingRef.current) {
        editingRef.current = false;
        commitTransaction();
      }
    },
    [commitTransaction],
  );

  // Range gestures own a transaction across updates. Discrete controls (typed
  // numbers, add/remove, blend, bypass) must capture their own history step.
  const mutateNode = useCallback<typeof updateNode>(
    (id, update) => {
      const ownsTransaction = !editingRef.current;
      if (ownsTransaction) beginTransaction();
      try {
        updateNode(id, update);
      } catch (error) {
        if (ownsTransaction) abortTransaction();
        throw error;
      }
      if (ownsTransaction) commitTransaction();
    },
    [updateNode, beginTransaction, commitTransaction, abortTransaction],
  );

  useEffect(() => finishTransaction, [nodeId, finishTransaction]);

  const updateFilter = useCallback(
    (filterId: string, patch: Partial<Adjustment>) => {
      if (!nodeId) return;
      mutateNode(nodeId, (current) => ({
        ...current,
        smartFilters: markTreatmentCustomized(current.smartFilters ?? [], filterId).map((filter) =>
          filter.id === filterId ? ({ ...filter, ...patch } as Adjustment) : filter,
        ),
      }));
    },
    [nodeId, mutateNode],
  );

  const addFilter = useCallback(
    (kind: AdjustmentKind, overrides: Partial<Adjustment> = {}) => {
      if (!nodeId) return;
      const filter = makeSmartFilter(cryptoId(), kind, overrides);
      mutateNode(nodeId, (current) => ({
        ...current,
        smartFilters: [...(current.smartFilters ?? []), filter],
      }));
      setSelectedId(filter.id);
      announce(`Added ${filterKindDisplayName(kind)} filter`);
    },
    [nodeId, mutateNode, announce],
  );

  const removeFilter = useCallback(
    (filterId: string) => {
      if (!nodeId) return;
      const filter = filters.find((f) => f.id === filterId);
      mutateNode(nodeId, (current) => ({
        ...current,
        smartFilters: markTreatmentCustomized(current.smartFilters ?? [], filterId).filter(
          (filter) => filter.id !== filterId,
        ),
      }));
      setSelectedId((current) => (current === filterId ? null : current));
      if (filter) announce(`Removed ${filterName(filter)} filter`);
    },
    [nodeId, mutateNode, announce, filters],
  );

  const reorderFilter = useCallback(
    (filterId: string, nextIndex: number) => {
      if (!nodeId) return;
      mutateNode(nodeId, (current) => {
        const stack = markTreatmentCustomized(current.smartFilters ?? [], filterId);
        const index = stack.findIndex((filter) => filter.id === filterId);
        if (index < 0) return current;
        const [filter] = stack.splice(index, 1);
        if (!filter) return current;
        stack.splice(Math.max(0, Math.min(nextIndex, stack.length)), 0, filter);
        return { ...current, smartFilters: stack };
      });
    },
    [nodeId, mutateNode],
  );

  const handleFilterReorder = useCallback(
    ({ event, items }: import('@varve/ui').SortableEndResult) => {
      if (!items || !nodeId) {
        finishTransaction();
        return;
      }
      const orderedIds = items.map(String);
      const activeId = String(event.active.id);
      mutateNode(nodeId, (current) => {
        const stack = markTreatmentCustomized(current.smartFilters ?? [], activeId);
        const byId = new Map(stack.map((filter) => [filter.id, filter]));
        const reordered = orderedIds
          .map((id) => byId.get(id))
          .filter((filter): filter is Adjustment => Boolean(filter));
        return reordered.length === stack.length
          ? { ...current, smartFilters: reordered }
          : current;
      });
      finishTransaction();
      const moved = filters.find((filter) => filter.id === activeId);
      if (moved) announce(`Moved ${filterName(moved)} filter`);
    },
    [announce, filters, finishTransaction, nodeId, mutateNode],
  );

  const duplicateFilter = useCallback(
    (filterId: string) => {
      if (!nodeId) return;
      const source = filters.find((filter) => filter.id === filterId);
      const copy = source ? cloneSmartFilters([source])[0] : undefined;
      if (!copy) return;
      delete copy.studioTreatment;
      mutateNode(nodeId, (current) => {
        const stack = current.smartFilters ?? [];
        const index = stack.findIndex((filter) => filter.id === filterId);
        if (index < 0) return current;
        const next = [...stack];
        next.splice(index + 1, 0, copy);
        return { ...current, smartFilters: next };
      });
      setSelectedId(copy.id);
    },
    [filters, nodeId, mutateNode],
  );

  const toggleStack = useCallback(() => {
    if (!nodeId) return;
    mutateNode(nodeId, (current) => ({
      ...current,
      smartFiltersEnabled: current.smartFiltersEnabled === false,
    }));
  }, [nodeId, mutateNode]);

  const selected = useMemo(
    () => filters.find((filter) => filter.id === selectedId) ?? null,
    [filters, selectedId],
  );
  const selectedIsKnown = selected ? isKnownAdjustmentKind(selected.kind) : false;

  if (!node || !compatible) return null;

  return (
    <DisclosureSection
      title="Object Filters"
      sectionId="smart-filters"
      action={
        <div className="smart-filters__header-actions">
          {filters.length > 0 && (
            <span
              role="status"
              className="smart-filters__count-badge"
              aria-label={`${filters.length} active filter${filters.length === 1 ? '' : 's'}`}
            >
              {filters.length}
            </span>
          )}
          <button
            type="button"
            className="smart-filters__stack-visibility"
            onClick={toggleStack}
            disabled={filters.length === 0}
            aria-label={stackEnabled ? 'Disable all Object Filters' : 'Enable all Object Filters'}
            aria-pressed={stackEnabled}
            title={stackEnabled ? 'Bypass all object filters' : 'Enable all object filters'}
          >
            <SolidIcon
              name={stackEnabled ? SOLID_CHROME_ICONS.visibility : SOLID_CHROME_ICONS.visibilityOff}
              size="0.8em"
            />
          </button>
        </div>
      }
    >
      {hasCuratedRecipeMembers && (
        <div className="smart-filters__curated-notice" role="status">
          <SolidIcon name="Info" size="0.85em" className="smart-filters__curated-icon" />
          <span>
            Named treatments are tuned in Effect Studio. Changing an entry here turns that treatment
            into a customized recipe; its current result remains editable.
          </span>
        </div>
      )}

      <details
        className="smart-filters__advanced"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary className="smart-filters__advanced-summary">
          <span className="smart-filters__advanced-title">Advanced stack editor</span>
          <small className="smart-filters__advanced-hint">
            Raw filters, order, opacity, and blending
          </small>
        </summary>
        <div className="smart-filters__advanced-body">
          {hasVectorFinishing && (
            <VectorFinishingQuickActions
              onAdd={(kind: VectorFinishingKind, preset) => addFilter(kind, preset)}
            />
          )}

          <ul className="smart-filters__stack" aria-label="Object Filter stack">
            {filters.length === 0 && (
              <li className="smart-filters__empty">
                <div className="smart-filters__empty-content">
                  <SolidIcon name="Faders" size="1em" className="smart-filters__empty-icon" />
                  <span className="smart-filters__empty-badge">Non-destructive</span>
                  <span className="smart-filters__empty-title">No filters applied.</span>
                  <span className="smart-filters__empty-hint">
                    Apply a filter below to non-destructively enhance color, depth, texture, or
                    blur. Raster placement and vector geometry stay editable.
                  </span>
                </div>
              </li>
            )}
            <Sortable
              items={filters.map((filter) => filter.id)}
              layout="vertical"
              onDragStart={startTransaction}
              onDragCancel={cancelTransaction}
              onReorder={handleFilterReorder}
              renderOverlay={(id) => {
                const filter = filters.find((candidate) => candidate.id === id);
                return filter ? (
                  <SortableOverlay className="smart-filters__drag-overlay">
                    {filterName(filter)}
                  </SortableOverlay>
                ) : null;
              }}
            >
              {filters.map((filter, index) => (
                <SortableItem
                  as="li"
                  className={`smart-filters__row${selectedId === filter.id ? ' smart-filters__row--selected' : ''}${filter.visible === false ? ' smart-filters__row--disabled' : ''}`}
                  key={filter.id}
                  id={filter.id}
                  data={{ type: 'smart-filter', filterId: filter.id }}
                >
                  <SortableItemHandle
                    className="smart-filters__drag-handle"
                    aria-label={`Drag ${filterName(filter)} filter to reorder`}
                  >
                    <SolidIcon name={SOLID_CHROME_ICONS.gripVertical} size="0.7em" />
                  </SortableItemHandle>
                  <div className="smart-filters__reorder">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => reorderFilter(filter.id, index - 1)}
                      aria-label={`Move ${filterName(filter)} up`}
                      title="Move filter up"
                    >
                      <SolidIcon name={SOLID_CHROME_ICONS.chevronUp} size="0.65em" />
                    </button>
                    <button
                      type="button"
                      disabled={index === filters.length - 1}
                      onClick={() => reorderFilter(filter.id, index + 1)}
                      aria-label={`Move ${filterName(filter)} down`}
                      title="Move filter down"
                    >
                      <SolidIcon name={SOLID_CHROME_ICONS.chevronDown} size="0.65em" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="smart-filters__visibility"
                    onClick={() => updateFilter(filter.id, { visible: !filter.visible })}
                    aria-label={
                      filter.visible
                        ? `Disable ${filterName(filter)}`
                        : `Enable ${filterName(filter)}`
                    }
                    aria-pressed={filter.visible}
                    title={filter.visible ? 'Bypass filter' : 'Enable filter'}
                  >
                    <SolidIcon
                      name={
                        filter.visible
                          ? SOLID_CHROME_ICONS.visibility
                          : SOLID_CHROME_ICONS.visibilityOff
                      }
                      size="0.75em"
                    />
                  </button>
                  <button
                    type="button"
                    ref={selectedId === filter.id ? editorAnchorRef : undefined}
                    className="smart-filters__name"
                    onClick={() =>
                      setSelectedId((current) => (current === filter.id ? null : filter.id))
                    }
                    aria-expanded={selectedId === filter.id}
                    aria-haspopup="dialog"
                  >
                    <span className="smart-filters__name-copy">
                      <span className="smart-filters__name-title">
                        <SolidIcon
                          name={filterKindIcon(filter.kind)}
                          size="0.75em"
                          className="smart-filters__kind-icon"
                        />
                        <span>{filterName(filter)}</span>
                      </span>
                      {studioTreatmentName(filter) && (
                        <small className="smart-filters__treatment-member">
                          {studioTreatmentName(filter)}
                          {filter.studioTreatment?.customized
                            ? ' · customized recipe'
                            : ' · recipe member'}
                        </small>
                      )}
                    </span>
                    <span className="smart-filters__badges">
                      {!isKnownAdjustmentKind(filter.kind) && (
                        <span className="smart-filters__unavailable">
                          Unavailable in this build
                        </span>
                      )}
                      {filter.blendMode && filter.blendMode !== 'normal' && (
                        <span
                          className="smart-filters__badge smart-filters__badge--blend"
                          aria-hidden="true"
                        >
                          {blendModeDisplayName(filter.blendMode)}
                        </span>
                      )}
                      {(filter.opacity ?? 1) < 1 && (
                        <span className="smart-filters__meta">
                          {Math.round((filter.opacity ?? 1) * 100)}%
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="smart-filters__remove"
                    onClick={() => removeFilter(filter.id)}
                    aria-label={`Remove ${filterName(filter)}`}
                    title="Remove filter"
                  >
                    <SolidIcon name={SOLID_CHROME_ICONS.close} size="0.7em" />
                  </button>
                </SortableItem>
              ))}
            </Sortable>
          </ul>

          <div className="smart-filters__add-label">
            <span>Add Object Filter</span>
            <Select
              label="Add Object Filter"
              value=""
              placeholder="Choose a filter…"
              groups={SMART_FILTER_GROUPS as import('@varve/ui').SelectOptionGroup[]}
              searchable={true}
              onChange={(value) => {
                if (value) addFilter(value as AdjustmentKind);
              }}
            />
          </div>

          {selected && (
            <InspectorFocusedEditor
              key={selected.id}
              anchorRef={editorAnchorRef}
              open
              title={`${filterName(selected)} parameters`}
              badge="filter"
              ownerKey={`${nodeId ?? 'document'}:${selected.id}`}
              onClose={() => setSelectedId(null)}
            >
              <div
                className="smart-filters__editor"
                onPointerDownCapture={(event) => {
                  if ((event.target as Element).matches('input[type="range"]')) startTransaction();
                }}
                onPointerUpCapture={finishTransaction}
                onPointerCancelCapture={finishTransaction}
                onKeyDownCapture={(event) => {
                  if ((event.target as Element).matches('input[type="range"]')) startTransaction();
                }}
                onKeyUpCapture={finishTransaction}
              >
                {selectedIsKnown ? (
                  <AdjustmentEditor
                    adjustment={selected}
                    onChange={(patch) => updateFilter(selected.id, patch)}
                    onEditStart={startTransaction}
                    onEditEnd={finishTransaction}
                    doc={undefined}
                  />
                ) : (
                  <div className="smart-filters__unavailable-panel" role="status">
                    <strong>Effect unavailable</strong>
                    <span>
                      This effect was created by a newer Varve build. It will round-trip safely, but
                      it cannot be previewed or edited here.
                    </span>
                  </div>
                )}

                <div className="smart-filters__compositing-card">
                  <div className="smart-filters__opacity">
                    <span className="smart-filters__compositing-label">
                      <span>Opacity</span>
                      <span className="smart-filters__compositing-actions">
                        <button
                          type="button"
                          className="smart-filters__icon-action"
                          disabled={!selectedIsKnown}
                          onClick={() =>
                            updateFilter(selected.id, makeSmartFilter(selected.id, selected.kind))
                          }
                          aria-label="Reset"
                          title="Reset parameters to defaults"
                        >
                          <SolidIcon name={SOLID_CHROME_ICONS.rotateCcw} size="0.8em" />
                        </button>
                        <button
                          type="button"
                          className="smart-filters__icon-action"
                          onClick={() => duplicateFilter(selected.id)}
                          aria-label="Duplicate"
                          title="Duplicate this filter"
                        >
                          <SolidIcon name={SOLID_CHROME_ICONS.copy} size="0.8em" />
                        </button>
                      </span>
                    </span>
                    <RangeValueControl
                      label={`${filterName(selected)} effect opacity`}
                      rangeClassName="smart-filters__effect-slider"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round((selected.opacity ?? 1) * 100)}
                      unit="%"
                      onChange={(next) => updateFilter(selected.id, { opacity: next / 100 })}
                    />
                  </div>
                  <div className="smart-filters__blend">
                    <span>Blend</span>
                    <Select
                      label={`${filterName(selected)} effect blend mode`}
                      value={selected.blendMode}
                      groups={groupBlendOptions(BLEND_OPTIONS)}
                      onChange={(value) =>
                        updateFilter(selected.id, { blendMode: value as AdjustmentBlendMode })
                      }
                    />
                  </div>
                </div>
              </div>
            </InspectorFocusedEditor>
          )}
        </div>
      </details>
    </DisclosureSection>
  );
}
