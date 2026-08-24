/**
 * LayoutSection — Taffy-backed flex/grid properties for a FrameNode selection.
 *
 * Mirrors strata-layout `LayoutStyle` (Rust). Controls: mode, direction, wrap,
 * gap (row/column), padding (per-side), alignment & justification, grid track
 * definitions + auto-flow + item placement, and clamp() fluid sizing
 * (min/preferred/max width/height).
 *
 * Per-child sizing modes (fixed/hug/fill) and grid item placement apply to the
 * selected children when a frame is the context — surfaced here as a sub-section
 * when the selection is inside a layout-enabled frame.
 *
 * Research basis: Figma auto-layout panel; APG Disclosure, Radiogroup, Spinbutton.
 */
import type {
  FlexDirection,
  FrameNode,
  GridItemPlacement,
  LayoutMode,
  LayoutSizing,
  LayoutStyle,
  SceneNode,
} from '@varve/scene';
import { Select } from '@varve/ui';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { suggestAutoLayout } from '../../../intelligence/autoLayoutSuggestor';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import type { SegmentedOption } from '../controls/SegmentedControl';
import { SegmentedControl } from '../controls/SegmentedControl';
import { commonValue, isMixed } from '../selection/selectionState';

const ALIGN_ITEMS_OPTIONS: readonly SegmentedOption<'start' | 'center' | 'end' | 'stretch'>[] = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Ctr' },
  { value: 'end', label: 'End' },
  { value: 'stretch', label: 'Str' },
] as const;

const JUSTIFY_OPTIONS: readonly SegmentedOption<
  'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround'
>[] = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Ctr' },
  { value: 'end', label: 'End' },
  { value: 'spaceBetween', label: 'Spc' },
  { value: 'spaceAround', label: 'Ard' },
] as const;

const SIZING_OPTIONS: { value: LayoutSizing; label: string }[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'hug', label: 'Hug contents' },
  { value: 'fill', label: 'Fill container' },
];

const GRID_AUTO_FLOW_OPTIONS: { value: NonNullable<LayoutStyle['gridAutoFlow']>; label: string }[] =
  [
    { value: 'row', label: 'Row' },
    { value: 'column', label: 'Column' },
    { value: 'rowDense', label: 'Row Dense' },
    { value: 'columnDense', label: 'Col Dense' },
  ];

export function LayoutSection({ node }: { node: FrameNode }) {
  const { setNodeClipContent, setNodeLayout, state } = useEditor();
  const ls = node.layoutStyle;

  const children = useMemo(
    () =>
      (node.children ?? [])
        .map((id) => state.document.nodes[id])
        .filter((n): n is import('@varve/scene').SceneNode => n != null),
    [node.children, state.document.nodes],
  );
  const suggestion = useMemo(
    () => (!ls ? suggestAutoLayout(node, children, state.document) : null),
    [node, children, ls, state.document],
  );

  function patch(partial: Partial<LayoutStyle>) {
    const base: LayoutStyle = ls ?? {
      mode: 'flex',
      direction: 'row',
      gap: 0,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 1,
    };
    setNodeLayout(node.id, { ...base, ...partial });
  }

  return (
    <DisclosureSection title="Layout" sectionId="layout">
      <FieldRow label="Clip content" htmlFor={`frame-clip-content-${node.id}`}>
        <input
          id={`frame-clip-content-${node.id}`}
          type="checkbox"
          className="insp-checkbox"
          checked={node.clipContent !== false}
          onChange={(event) => setNodeClipContent(node.id, event.target.checked)}
        />
      </FieldRow>
      {suggestion && !ls && (
        <div
          className="insp-hint"
          style={{
            fontSize: 'var(--font-size-xs)',
            padding: 'var(--space-1) var(--space-2)',
            background: 'var(--color-surface-sunken)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            marginBottom: 'var(--space-1)',
          }}
        >
          <span style={{ flex: 1 }}>
            Auto-layout suggested ({Math.round(suggestion.confidence * 100)}% confidence)
          </span>
          <button
            type="button"
            className="insp-hint__apply"
            onClick={() => setNodeLayout(node.id, suggestion.suggestedStyle)}
            style={{
              fontSize: 'var(--font-size-xs)',
              padding: '2px 6px',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--elevation-surface-default)',
              cursor: 'pointer',
            }}
          >
            Apply
          </button>
        </div>
      )}
      <FieldRow label="Mode">
        <Select
          label="Layout mode"
          value={ls?.mode ?? 'none'}
          options={[
            { value: 'none', label: 'None' },
            { value: 'flex', label: 'Flex' },
            { value: 'grid', label: 'Grid' },
          ]}
          onChange={(v) => {
            if (v === 'none') setNodeLayout(node.id, undefined);
            else patch({ mode: v as LayoutMode });
          }}
        />
      </FieldRow>
      {ls && (
        <>
          <FieldRow label="Direction">
            <Select
              label="Layout direction"
              value={ls.direction}
              options={[
                { value: 'row', label: 'Row' },
                { value: 'column', label: 'Column' },
                { value: 'rowReverse', label: 'Row reverse' },
                { value: 'columnReverse', label: 'Column reverse' },
              ]}
              onChange={(v) => patch({ direction: v as FlexDirection })}
            />
          </FieldRow>
          {ls.mode === 'grid' && (
            <>
              <FieldRow label="Grid Cols" htmlFor={`layout-grid-cols-${node.id}`}>
                <input
                  id={`layout-grid-cols-${node.id}`}
                  type="text"
                  value={ls.gridTemplateColumns ?? ''}
                  placeholder="e.g., 1fr 1fr 1fr"
                  className="insp-select"
                  onChange={(e) => patch({ gridTemplateColumns: e.target.value || undefined })}
                  aria-label="Grid template columns"
                />
              </FieldRow>
              <FieldRow label="Grid Rows" htmlFor={`layout-grid-rows-${node.id}`}>
                <input
                  id={`layout-grid-rows-${node.id}`}
                  type="text"
                  value={ls.gridTemplateRows ?? ''}
                  placeholder="e.g., auto 1fr auto"
                  className="insp-select"
                  onChange={(e) => patch({ gridTemplateRows: e.target.value || undefined })}
                  aria-label="Grid template rows"
                />
              </FieldRow>
              <FieldRow label="Auto Flow">
                <Select
                  label="Grid auto flow"
                  value={ls.gridAutoFlow ?? 'row'}
                  options={GRID_AUTO_FLOW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  onChange={(v) =>
                    patch({
                      gridAutoFlow: v as NonNullable<LayoutStyle['gridAutoFlow']>,
                    })
                  }
                />
              </FieldRow>
              <NumberField
                label="Row gap"
                unit="px"
                value={ls.rowGap ?? ls.gap}
                min={0}
                onChange={(v) => patch({ rowGap: v })}
              />
              <NumberField
                label="Col gap"
                unit="px"
                value={ls.columnGap ?? ls.gap}
                min={0}
                onChange={(v) => patch({ columnGap: v })}
              />
            </>
          )}
          {ls.mode === 'flex' && (
            <>
              <NumberField
                label="Gap"
                unit="px"
                value={ls.gap}
                min={0}
                onChange={(v) => patch({ gap: v })}
              />
              <FieldRow label="Wrap">
                <input
                  type="checkbox"
                  className="insp-checkbox"
                  checked={ls.wrap}
                  aria-label="Wrap"
                  onChange={(e) => patch({ wrap: e.target.checked })}
                />
              </FieldRow>
              <FieldRow label="Align">
                <SegmentedControl
                  label="Align items"
                  value={ls.alignItems ?? 'start'}
                  options={ALIGN_ITEMS_OPTIONS}
                  onChange={(v) => patch({ alignItems: v })}
                />
              </FieldRow>
              <FieldRow label="Justify">
                <SegmentedControl
                  label="Justify content"
                  value={ls.justifyContent ?? 'start'}
                  options={JUSTIFY_OPTIONS}
                  onChange={(v) => patch({ justifyContent: v })}
                />
              </FieldRow>
            </>
          )}
          <FieldRow label="Padding">
            <div style={{ display: 'flex', gap: 'var(--space-1)', flex: 1 }}>
              {(['T', 'R', 'B', 'L'] as const).map((side, i) => (
                <input
                  key={side}
                  type="number"
                  aria-label={`Padding ${side}`}
                  value={ls.padding[i] ?? 0}
                  step={1}
                  onChange={(e) => {
                    const p = [...ls.padding] as [number, number, number, number];
                    p[i] = Number(e.target.value) || 0;
                    patch({ padding: p });
                  }}
                  className="insp-per-side"
                />
              ))}
            </div>
          </FieldRow>
          <FieldRow label="Grow">
            <input
              type="number"
              aria-label="Flex grow"
              value={ls.grow}
              step={1}
              min={0}
              onChange={(e) => patch({ grow: Number(e.target.value) || 0 })}
              className="insp-select"
            />
          </FieldRow>
          <FieldRow label="Shrink">
            <input
              type="number"
              aria-label="Flex shrink"
              value={ls.shrink}
              step={1}
              min={0}
              onChange={(e) => patch({ shrink: Number(e.target.value) || 0 })}
              className="insp-select"
            />
          </FieldRow>
        </>
      )}
      {/* Clamp() fluid sizing for the frame itself */}
      <ClampSizingControls nodes={[node]} />
    </DisclosureSection>
  );
}

/**
 * ClampSizingControls — min/preferred/max width/height for clamp() fluid sizing.
 * Also surfaces per-child sizing mode (fixed/hug/fill) and grid item placement
 * when the selected nodes are children of a layout-enabled frame.
 */
function ClampSizingControls({ nodes }: { nodes: SceneNode[] }) {
  const editor = useEditor();
  const {
    setSelectedMinWidth,
    setSelectedMaxWidth,
    setSelectedMinHeight,
    setSelectedMaxHeight,
    setSelectedLayoutSizingWidth,
    setSelectedLayoutSizingHeight,
    setSelectedGridPlacement,
  } = editor;

  const minWRaw = commonValue(nodes, (n) => n.minWidth);
  const maxWRaw = commonValue(nodes, (n) => n.maxWidth);
  const minHRaw = commonValue(nodes, (n) => n.minHeight);
  const maxHRaw = commonValue(nodes, (n) => n.maxHeight);
  const widthSizingRaw = commonValue(
    nodes,
    (n) => n.layoutSizingWidth ?? n.layoutSizing ?? 'fixed',
  );
  const heightSizingRaw = commonValue(
    nodes,
    (n) => n.layoutSizingHeight ?? n.layoutSizing ?? 'fixed',
  );
  const gridColStartRaw = commonValue(nodes, (n) => n.gridPlacement?.gridColumnStart);
  const gridColEndRaw = commonValue(nodes, (n) => n.gridPlacement?.gridColumnEnd);
  const gridRowStartRaw = commonValue(nodes, (n) => n.gridPlacement?.gridRowStart);
  const gridRowEndRaw = commonValue(nodes, (n) => n.gridPlacement?.gridRowEnd);

  const patchGrid = (partial: Partial<GridItemPlacement>) => {
    const base: GridItemPlacement = {
      gridColumnStart: !isMixed(gridColStartRaw) ? gridColStartRaw : undefined,
      gridColumnEnd: !isMixed(gridColEndRaw) ? gridColEndRaw : undefined,
      gridRowStart: !isMixed(gridRowStartRaw) ? gridRowStartRaw : undefined,
      gridRowEnd: !isMixed(gridRowEndRaw) ? gridRowEndRaw : undefined,
    };
    setSelectedGridPlacement({ ...base, ...partial });
  };

  return (
    <div
      style={{
        marginTop: 'var(--space-1)',
        paddingTop: 'var(--space-1)',
        borderTop: '1px solid var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
      }}
    >
      <div
        style={{
          fontSize: 'var(--font-size-xs)',
          fontWeight: 'var(--font-weight-medium)',
          color: 'var(--color-text-secondary)',
        }}
      >
        Sizing
      </div>
      <FieldRow label="Width">
        <Select
          label="Width sizing mode"
          value={isMixed(widthSizingRaw) ? '' : widthSizingRaw}
          placeholder={isMixed(widthSizingRaw) ? 'Mixed' : undefined}
          options={SIZING_OPTIONS}
          onChange={(v) => setSelectedLayoutSizingWidth(v as LayoutSizing)}
        />
      </FieldRow>
      <FieldRow label="Height">
        <Select
          label="Height sizing mode"
          value={isMixed(heightSizingRaw) ? '' : heightSizingRaw}
          placeholder={isMixed(heightSizingRaw) ? 'Mixed' : undefined}
          options={SIZING_OPTIONS}
          onChange={(v) => setSelectedLayoutSizingHeight(v as LayoutSizing)}
        />
      </FieldRow>
      <NumberField
        label="Min W"
        unit="px"
        value={isMixed(minWRaw) ? 0 : (minWRaw ?? 0)}
        mixed={isMixed(minWRaw)}
        min={0}
        onChange={setSelectedMinWidth}
      />
      <NumberField
        label="Max W"
        unit="px"
        value={isMixed(maxWRaw) ? 0 : (maxWRaw ?? 0)}
        mixed={isMixed(maxWRaw)}
        min={0}
        onChange={setSelectedMaxWidth}
      />
      <NumberField
        label="Min H"
        unit="px"
        value={isMixed(minHRaw) ? 0 : (minHRaw ?? 0)}
        mixed={isMixed(minHRaw)}
        min={0}
        onChange={setSelectedMinHeight}
      />
      <NumberField
        label="Max H"
        unit="px"
        value={isMixed(maxHRaw) ? 0 : (maxHRaw ?? 0)}
        mixed={isMixed(maxHRaw)}
        min={0}
        onChange={setSelectedMaxHeight}
      />
      {/* Grid item placement */}
      <div
        style={{
          fontSize: 'var(--font-size-xs)',
          fontWeight: 'var(--font-weight-medium)',
          color: 'var(--color-text-secondary)',
          marginTop: 'var(--space-1)',
        }}
      >
        Grid Placement
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
        <NumberField
          label="Col start"
          value={isMixed(gridColStartRaw) ? 0 : (gridColStartRaw ?? 0)}
          mixed={isMixed(gridColStartRaw)}
          min={0}
          onChange={(v) => patchGrid({ gridColumnStart: v || undefined })}
        />
        <NumberField
          label="Col end"
          value={isMixed(gridColEndRaw) ? 0 : (gridColEndRaw ?? 0)}
          mixed={isMixed(gridColEndRaw)}
          min={0}
          onChange={(v) => patchGrid({ gridColumnEnd: v || undefined })}
        />
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
        <NumberField
          label="Row start"
          value={isMixed(gridRowStartRaw) ? 0 : (gridRowStartRaw ?? 0)}
          mixed={isMixed(gridRowStartRaw)}
          min={0}
          onChange={(v) => patchGrid({ gridRowStart: v || undefined })}
        />
        <NumberField
          label="Row end"
          value={isMixed(gridRowEndRaw) ? 0 : (gridRowEndRaw ?? 0)}
          mixed={isMixed(gridRowEndRaw)}
          min={0}
          onChange={(v) => patchGrid({ gridRowEnd: v || undefined })}
        />
      </div>
    </div>
  );
}
