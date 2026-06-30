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
} from '@strata/scene';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import type { SegmentedOption } from '../controls/SegmentedControl';
import { SegmentedControl } from '../controls/SegmentedControl';
import { commonValue, isMixed } from '../selection/selectionState';

const NATIVE_SELECT: React.CSSProperties = {
  flex: 1,
  height: 'var(--space-5)',
  fontSize: 'var(--font-size-xs)',
  background: 'var(--color-surface-sunken)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-2)',
};

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
  { value: 'hug', label: 'Hug' },
  { value: 'fill', label: 'Fill' },
];

const GRID_AUTO_FLOW_OPTIONS: { value: NonNullable<LayoutStyle['gridAutoFlow']>; label: string }[] =
  [
    { value: 'row', label: 'Row' },
    { value: 'column', label: 'Column' },
    { value: 'rowDense', label: 'Row Dense' },
    { value: 'columnDense', label: 'Col Dense' },
  ];

export function LayoutSection({ node }: { node: FrameNode }) {
  const { setNodeLayout } = useEditor();
  const ls = node.layoutStyle;

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
    <DisclosureSection title="Layout">
      <FieldRow label="Mode" htmlFor={`layout-mode-${node.id}`}>
        <select
          id={`layout-mode-${node.id}`}
          value={ls?.mode ?? 'none'}
          style={NATIVE_SELECT}
          onChange={(e) => {
            if (e.target.value === 'none') setNodeLayout(node.id, undefined);
            else patch({ mode: e.target.value as LayoutMode });
          }}
        >
          <option value="none">None</option>
          <option value="flex">Flex</option>
          <option value="grid">Grid</option>
        </select>
      </FieldRow>
      {ls && (
        <>
          <FieldRow label="Direction" htmlFor={`layout-dir-${node.id}`}>
            <select
              id={`layout-dir-${node.id}`}
              value={ls.direction}
              style={NATIVE_SELECT}
              onChange={(e) => patch({ direction: e.target.value as FlexDirection })}
            >
              <option value="row">Row</option>
              <option value="column">Column</option>
              <option value="rowReverse">Row reverse</option>
              <option value="columnReverse">Column reverse</option>
            </select>
          </FieldRow>
          {ls.mode === 'grid' && (
            <>
              <FieldRow label="Grid Cols" htmlFor={`layout-grid-cols-${node.id}`}>
                <input
                  id={`layout-grid-cols-${node.id}`}
                  type="text"
                  value={ls.gridTemplateColumns ?? ''}
                  placeholder="e.g., 1fr 1fr 1fr"
                  style={NATIVE_SELECT}
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
                  style={NATIVE_SELECT}
                  onChange={(e) => patch({ gridTemplateRows: e.target.value || undefined })}
                  aria-label="Grid template rows"
                />
              </FieldRow>
              <FieldRow label="Auto Flow" htmlFor={`layout-auto-flow-${node.id}`}>
                <select
                  id={`layout-auto-flow-${node.id}`}
                  value={ls.gridAutoFlow ?? 'row'}
                  style={NATIVE_SELECT}
                  onChange={(e) =>
                    patch({
                      gridAutoFlow: e.target.value as NonNullable<LayoutStyle['gridAutoFlow']>,
                    })
                  }
                >
                  {GRID_AUTO_FLOW_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
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
                  checked={ls.wrap}
                  aria-label="Wrap"
                  onChange={(e) => patch({ wrap: e.target.checked })}
                />
              </FieldRow>
              <FieldRow label="Align">
                <SegmentedControl
                  label="Align items"
                  value={ls.alignItems ?? 'stretch'}
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
            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
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
                  style={{
                    width: 36,
                    fontSize: 'var(--font-size-xs)',
                    background: 'var(--color-surface-sunken)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0 var(--space-1)',
                  }}
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
              style={NATIVE_SELECT}
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
              style={NATIVE_SELECT}
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
    setSelectedLayoutSizing,
    setSelectedGridPlacement,
  } = editor;

  const minWRaw = commonValue(nodes, (n) => n.minWidth);
  const maxWRaw = commonValue(nodes, (n) => n.maxWidth);
  const minHRaw = commonValue(nodes, (n) => n.minHeight);
  const maxHRaw = commonValue(nodes, (n) => n.maxHeight);
  const sizingRaw = commonValue(nodes, (n) => n.layoutSizing ?? 'fixed');
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
      <FieldRow label="Mode" htmlFor="layout-sizing-mode">
        <select
          id="layout-sizing-mode"
          aria-label="Layout sizing mode"
          value={isMixed(sizingRaw) ? '' : sizingRaw}
          style={NATIVE_SELECT}
          onChange={(e) => setSelectedLayoutSizing(e.target.value as LayoutSizing)}
        >
          {isMixed(sizingRaw) && <option value="">Mixed</option>}
          {SIZING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
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
