/**
 * Object Filters — object-local, nondestructive filter stack editor.
 *
 * The stack is stored on the selected scene node. This section intentionally
 * shares AdjustmentEditor with adjustment layers so new filter kinds only need
 * one parameter editor and one engine FilterIR implementation.
 */
import type { Adjustment, AdjustmentBlendMode, AdjustmentKind } from '@varve/engine';
import { filterKindDisplayName } from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import {
  canHaveSmartFilters,
  cloneSmartFilters,
  cryptoId,
  makeSmartFilter,
  SMART_FILTER_KINDS,
} from '@varve/scene';
import { Select, SOLID_CHROME_ICONS, SolidIcon } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { AdjustmentEditor } from '../../AdjustmentLayer/AdjustmentEditor';
import { DisclosureSection } from '../controls/DisclosureSection';
import './smartFilters.css';

export interface SmartFiltersSectionProps {
  nodes: SceneNode[];
}

const BLEND_OPTIONS: { value: AdjustmentBlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
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
  return filterKindDisplayName(filter.kind as AdjustmentKind);
}

export function SmartFiltersSection({ nodes }: SmartFiltersSectionProps) {
  const { updateNode, beginTransaction, commitTransaction } = useEditor();
  const node = nodes.length === 1 ? nodes[0] : undefined;
  const nodeId = node?.id;
  const compatible = node ? canHaveSmartFilters(node) : false;
  const filters = compatible && node ? (node.smartFilters ?? []) : [];
  const stackEnabled = node?.smartFiltersEnabled !== false;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const editingRef = useRef(false);

  const finishTransaction = useCallback(() => {
    if (!editingRef.current) return;
    editingRef.current = false;
    commitTransaction();
  }, [commitTransaction]);

  const startTransaction = useCallback(() => {
    if (editingRef.current) return;
    editingRef.current = true;
    beginTransaction();
  }, [beginTransaction]);

  useEffect(() => {
    if (!filters.some((filter) => filter.id === selectedId)) {
      setSelectedId(filters[0]?.id ?? null);
    }
  }, [filters, selectedId]);

  useEffect(
    () => () => {
      if (editingRef.current) {
        editingRef.current = false;
        commitTransaction();
      }
    },
    [commitTransaction],
  );

  const updateFilter = useCallback(
    (filterId: string, patch: Partial<Adjustment>) => {
      if (!nodeId) return;
      updateNode(nodeId, (current) => ({
        ...current,
        smartFilters: (current.smartFilters ?? []).map((filter) =>
          filter.id === filterId ? ({ ...filter, ...patch } as Adjustment) : filter,
        ),
      }));
    },
    [nodeId, updateNode],
  );

  const addFilter = useCallback(
    (kind: AdjustmentKind) => {
      if (!nodeId) return;
      const filter = makeSmartFilter(cryptoId(), kind);
      updateNode(nodeId, (current) => ({
        ...current,
        smartFilters: [...(current.smartFilters ?? []), filter],
      }));
      setSelectedId(filter.id);
    },
    [nodeId, updateNode],
  );

  const removeFilter = useCallback(
    (filterId: string) => {
      if (!nodeId) return;
      updateNode(nodeId, (current) => ({
        ...current,
        smartFilters: (current.smartFilters ?? []).filter((filter) => filter.id !== filterId),
      }));
      setSelectedId((current) => (current === filterId ? null : current));
    },
    [nodeId, updateNode],
  );

  const reorderFilter = useCallback(
    (filterId: string, nextIndex: number) => {
      if (!nodeId) return;
      updateNode(nodeId, (current) => {
        const stack = [...(current.smartFilters ?? [])];
        const index = stack.findIndex((filter) => filter.id === filterId);
        if (index < 0) return current;
        const [filter] = stack.splice(index, 1);
        if (!filter) return current;
        stack.splice(Math.max(0, Math.min(nextIndex, stack.length)), 0, filter);
        return { ...current, smartFilters: stack };
      });
    },
    [nodeId, updateNode],
  );

  const duplicateFilter = useCallback(
    (filterId: string) => {
      if (!nodeId) return;
      const source = filters.find((filter) => filter.id === filterId);
      const copy = source ? cloneSmartFilters([source])[0] : undefined;
      if (!copy) return;
      updateNode(nodeId, (current) => {
        const stack = current.smartFilters ?? [];
        const index = stack.findIndex((filter) => filter.id === filterId);
        if (index < 0) return current;
        const next = [...stack];
        next.splice(index + 1, 0, copy);
        return { ...current, smartFilters: next };
      });
      setSelectedId(copy.id);
    },
    [filters, nodeId, updateNode],
  );

  const toggleStack = useCallback(() => {
    if (!nodeId) return;
    updateNode(nodeId, (current) => ({
      ...current,
      smartFiltersEnabled: current.smartFiltersEnabled === false,
    }));
  }, [nodeId, updateNode]);

  const selected = useMemo(
    () => filters.find((filter) => filter.id === selectedId) ?? null,
    [filters, selectedId],
  );

  if (!node || !compatible) return null;

  return (
    <DisclosureSection title="Object Filters" sectionId="smart-filters">
      <div className="smart-filters__intro-row">
        <div className="smart-filters__intro">
          Filters are attached to this object and keep the original content editable.
        </div>
        <button
          type="button"
          className="smart-filters__stack-visibility"
          onClick={toggleStack}
          disabled={filters.length === 0}
          aria-label={stackEnabled ? 'Disable all Object Filters' : 'Enable all Object Filters'}
          aria-pressed={stackEnabled}
        >
          <SolidIcon
            name={stackEnabled ? SOLID_CHROME_ICONS.visibility : SOLID_CHROME_ICONS.visibilityOff}
            size="0.8em"
          />
        </button>
      </div>

      <ul className="smart-filters__stack" aria-label="Object Filter stack">
        {filters.length === 0 && <li className="smart-filters__empty">No filters applied.</li>}
        {filters.map((filter, index) => (
          <li
            className={`smart-filters__row${selectedId === filter.id ? ' smart-filters__row--selected' : ''}`}
            key={filter.id}
          >
            <div className="smart-filters__reorder">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => reorderFilter(filter.id, index - 1)}
                aria-label={`Move ${filterName(filter)} up`}
              >
                <SolidIcon name={SOLID_CHROME_ICONS.chevronUp} size="0.65em" />
              </button>
              <button
                type="button"
                disabled={index === filters.length - 1}
                onClick={() => reorderFilter(filter.id, index + 1)}
                aria-label={`Move ${filterName(filter)} down`}
              >
                <SolidIcon name={SOLID_CHROME_ICONS.chevronDown} size="0.65em" />
              </button>
            </div>
            <button
              type="button"
              className="smart-filters__visibility"
              onClick={() => updateFilter(filter.id, { visible: !filter.visible })}
              aria-label={
                filter.visible ? `Disable ${filterName(filter)}` : `Enable ${filterName(filter)}`
              }
              aria-pressed={filter.visible}
            >
              <SolidIcon
                name={
                  filter.visible ? SOLID_CHROME_ICONS.visibility : SOLID_CHROME_ICONS.visibilityOff
                }
                size="0.75em"
              />
            </button>
            <button
              type="button"
              className="smart-filters__name"
              onClick={() => setSelectedId(filter.id)}
              aria-expanded={selectedId === filter.id}
            >
              <span>{filterName(filter)}</span>
              <span className="smart-filters__meta">
                {Math.round((filter.opacity ?? 1) * 100)}%
              </span>
            </button>
            <button
              type="button"
              className="smart-filters__remove"
              onClick={() => removeFilter(filter.id)}
              aria-label={`Remove ${filterName(filter)}`}
            >
              <SolidIcon name={SOLID_CHROME_ICONS.close} size="0.7em" />
            </button>
          </li>
        ))}
      </ul>

      <label className="smart-filters__add-label">
        <span>Add Object Filter</span>
        <select
          value=""
          aria-label="Add Object Filter"
          onChange={(event) => {
            const kind = event.target.value as AdjustmentKind;
            if (kind) addFilter(kind);
          }}
        >
          <option value="">Choose a filter…</option>
          {SMART_FILTER_KINDS.map((kind) => (
            <option value={kind} key={kind}>
              {filterKindDisplayName(kind)}
            </option>
          ))}
        </select>
      </label>

      {selected && (
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
          <div className="smart-filters__editor-title">
            <span>{filterName(selected)}</span>
            <span>{Math.round((selected.opacity ?? 1) * 100)}%</span>
          </div>
          <AdjustmentEditor
            adjustment={selected}
            onChange={(patch) => updateFilter(selected.id, patch)}
            onEditStart={startTransaction}
            onEditEnd={finishTransaction}
            doc={undefined}
          />
          <label className="smart-filters__opacity">
            <span>
              <span>Effect Opacity</span>
              <span>{Math.round((selected.opacity ?? 1) * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round((selected.opacity ?? 1) * 100)}
              onChange={(event) =>
                updateFilter(selected.id, { opacity: Number(event.target.value) / 100 })
              }
              aria-label={`${filterName(selected)} effect opacity`}
            />
          </label>
          <div className="smart-filters__blend">
            <span>Effect Blend</span>
            <Select
              label={`${filterName(selected)} effect blend mode`}
              value={selected.blendMode}
              options={BLEND_OPTIONS}
              onChange={(value) =>
                updateFilter(selected.id, { blendMode: value as AdjustmentBlendMode })
              }
            />
          </div>
          <div className="smart-filters__actions">
            <button
              type="button"
              onClick={() => updateFilter(selected.id, makeSmartFilter(selected.id, selected.kind))}
            >
              Reset
            </button>
            <button type="button" onClick={() => duplicateFilter(selected.id)}>
              Duplicate
            </button>
          </div>
        </div>
      )}
    </DisclosureSection>
  );
}
