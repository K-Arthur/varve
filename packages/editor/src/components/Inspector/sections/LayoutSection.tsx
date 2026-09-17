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
  LayoutGrid,
  LayoutMode,
  LayoutSizing,
  LayoutStyle,
  SceneNode,
} from '@varve/scene';
import { Select, Switch } from '@varve/ui';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { suggestAutoLayout } from '../../../intelligence/autoLayoutSuggestor';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow, InspectorFieldGroup } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import type { SegmentedOption } from '../controls/SegmentedControl';
import { SegmentedControl } from '../controls/SegmentedControl';
import { commonValue, isMixed } from '../selection/selectionState';
import { GridPlacementFields } from './GridPlacementFields';

const ALIGN_ITEMS_OPTIONS: readonly SegmentedOption<'start' | 'center' | 'end' | 'stretch'>[] = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Ctr' },
  { value: 'end', label: 'End' },
  { value: 'stretch', label: 'Str' },
] as const;

const JUSTIFY_OPTIONS: readonly SegmentedOption<
  'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly'
>[] = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Ctr' },
  { value: 'end', label: 'End' },
  { value: 'spaceBetween', label: 'Spc' },
  { value: 'spaceAround', label: 'Ard' },
  { value: 'spaceEvenly', label: 'Evn' },
] as const;

const SIZING_OPTIONS: { value: LayoutSizing; label: string }[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'hug', label: 'Hug contents' },
  { value: 'fill', label: 'Fill container' },
  { value: 'relative', label: 'Relative %' },
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
    <>
      <DisclosureSection title="Stack / Grid" sectionId="layout">
        <FieldRow label="Clip content" htmlFor={`frame-clip-content-${node.id}`}>
          <Switch
            id={`frame-clip-content-${node.id}`}
            aria-label="Clip content"
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
              borderRadius: 'var(--radius-control-compact)',
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
                borderRadius: 'var(--radius-control-compact)',
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
                    options={GRID_AUTO_FLOW_OPTIONS.map((o) => ({
                      value: o.value,
                      label: o.label,
                    }))}
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
                  min={-100000}
                  onChange={(v) => patch({ gap: v })}
                />
                <FieldRow label="Wrap">
                  <Switch
                    aria-label="Wrap"
                    checked={ls.wrap}
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
              <div className="insp-per-side-grid" style={{ gap: 'var(--space-1)', flex: 1 }}>
                {(['T', 'R', 'B', 'L'] as const).map((side, i) => (
                  <input
                    key={side}
                    type="number"
                    aria-label={`Padding ${side}`}
                    value={ls.padding[i] ?? 0}
                    step={1}
                    min={0}
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
            <InspectorFieldGroup columns={2}>
              <NumberField
                label="Grow"
                value={ls.grow}
                min={0}
                step={1}
                onChange={(v) => patch({ grow: v })}
              />
              <NumberField
                label="Shrink"
                value={ls.shrink}
                min={0}
                step={1}
                onChange={(v) => patch({ shrink: v })}
              />
            </InspectorFieldGroup>
            <FieldRow label="Borders in layout" wrapLabel>
              <Switch
                aria-label="Include visible borders in layout"
                checked={ls.includeBordersInLayout === true}
                onChange={(event) => patch({ includeBordersInLayout: event.target.checked })}
              />
            </FieldRow>
            <FieldRow label="Overlap order" wrapLabel>
              <Select
                label="Overlap paint order"
                value={ls.overlapOrder ?? 'legacy'}
                options={[
                  { value: 'legacy', label: 'Legacy (last on top)' },
                  { value: 'firstOnTop', label: 'First child on top' },
                  { value: 'lastOnTop', label: 'Last child on top' },
                ]}
                onChange={(value) => patch({ overlapOrder: value as LayoutStyle['overlapOrder'] })}
              />
            </FieldRow>
            <p className="insp-panel__color-mode-note" role="note">
              Negative gaps overlap items. Shadows and blur stay out of layout measurement.
            </p>
          </>
        )}
        {/* Clamp() fluid sizing for the frame itself */}
        <ClampSizingControls nodes={[node]} />
      </DisclosureSection>
      <GridPlacementFields nodes={[node]} />
      <LayoutGuidesSection node={node} />
    </>
  );
}

function LayoutGuidesSection({ node }: { node: FrameNode }) {
  const { state, setLayoutGrid, removeLayoutGrid } = useEditor();
  const guides = state.document.gridSettings?.layoutGrids?.[node.id] ?? [];

  const updateGuide = (guide: LayoutGrid, patch: Partial<LayoutGrid>) => {
    setLayoutGrid(node.id, { ...guide, ...patch });
  };

  const addGuide = () => {
    let index = guides.length + 1;
    let id = `layout-guide-${node.id}-${index}`;
    while (guides.some((guide) => guide.id === id)) {
      index += 1;
      id = `layout-guide-${node.id}-${index}`;
    }
    setLayoutGrid(node.id, {
      id,
      type: 'layout',
      name: `Layout guide ${index}`,
      visible: true,
      snapEnabled: true,
      color: 'var(--color-interactive-default)',
      opacity: 0.35,
      scope: 'frame',
      frameId: node.id,
      layoutMode: 'columns',
      columnCount: 12,
      gutter: 20,
      margin: [20, 20, 20, 20],
      alignment: 'stretch',
    });
  };

  return (
    <DisclosureSection title="Layout guides" sectionId="layout" subsectionId="layoutGuides">
      <div className="insp-canvas-props">
        <p className="insp-panel__color-mode-note" role="note">
          Visual frame guides do not arrange children. Use Auto layout above to change child
          arrangement.
        </p>
        <button type="button" className="insp-btn insp-btn--compact" onClick={addGuide}>
          Add layout guide
        </button>
        {guides.map((guide, index) => (
          <fieldset
            key={guide.id}
            className="insp-layout-guide-card"
            aria-label={guide.name ?? `Layout guide ${index + 1}`}
          >
            <legend>{guide.name ?? `Guide ${index + 1}`}</legend>
            <FieldRow label="Visibility">
              <div className="insp-field__control--inline">
                <Switch
                  label={`Show ${guide.name ?? `layout guide ${index + 1}`}`}
                  checked={guide.visible}
                  onChange={(event) => updateGuide(guide, { visible: event.target.checked })}
                />
                <Switch
                  label={`Snap to ${guide.name ?? `layout guide ${index + 1}`}`}
                  checked={guide.snapEnabled}
                  onChange={(event) => updateGuide(guide, { snapEnabled: event.target.checked })}
                />
              </div>
            </FieldRow>
            <FieldRow label="Type">
              <Select
                label={`Layout guide type ${index + 1}`}
                value={guide.layoutMode}
                options={[
                  { value: 'columns', label: 'Columns' },
                  { value: 'rows', label: 'Rows' },
                  { value: 'uniform', label: 'Uniform' },
                ]}
                onChange={(value) =>
                  updateGuide(guide, {
                    layoutMode: value as LayoutGrid['layoutMode'],
                    ...(value === 'rows' && guide.rowCount === undefined ? { rowCount: 4 } : {}),
                    ...(value === 'uniform' && guide.rowCount === undefined ? { rowCount: 4 } : {}),
                  })
                }
              />
            </FieldRow>
            {(guide.layoutMode === 'columns' || guide.layoutMode === 'uniform') && (
              <NumberField
                label="Columns"
                unit="tracks"
                value={guide.columnCount ?? 1}
                min={1}
                max={100}
                step={1}
                onChange={(value) => updateGuide(guide, { columnCount: Math.round(value) })}
              />
            )}
            {(guide.layoutMode === 'rows' || guide.layoutMode === 'uniform') && (
              <NumberField
                label="Rows"
                unit="tracks"
                value={guide.rowCount ?? 1}
                min={1}
                max={100}
                step={1}
                onChange={(value) => updateGuide(guide, { rowCount: Math.round(value) })}
              />
            )}
            {(guide.layoutMode === 'columns' || guide.layoutMode === 'uniform') && (
              <NumberField
                label="Column width"
                unit="px"
                value={guide.columnWidth ?? 0}
                min={0}
                max={100000}
                onChange={(value) =>
                  updateGuide(guide, { columnWidth: value > 0 ? value : undefined })
                }
              />
            )}
            {(guide.layoutMode === 'rows' || guide.layoutMode === 'uniform') && (
              <NumberField
                label="Row height"
                unit="px"
                value={guide.rowHeight ?? 0}
                min={0}
                max={100000}
                onChange={(value) =>
                  updateGuide(guide, { rowHeight: value > 0 ? value : undefined })
                }
              />
            )}
            <NumberField
              label="Gutter"
              unit="px"
              value={guide.gutter}
              min={0}
              max={1000}
              onChange={(value) => updateGuide(guide, { gutter: value })}
            />
            <FieldRow label="Alignment">
              <Select
                label={`Layout guide alignment ${index + 1}`}
                value={guide.alignment}
                options={[
                  { value: 'stretch', label: 'Stretch' },
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Center' },
                  { value: 'right', label: 'Right' },
                ]}
                onChange={(value) =>
                  updateGuide(guide, { alignment: value as LayoutGrid['alignment'] })
                }
              />
            </FieldRow>
            <div className="insp-layout-guide-card__margins">
              {(['Top', 'Right', 'Bottom', 'Left'] as const).map((side, marginIndex) => (
                <NumberField
                  key={side}
                  label={side}
                  unit="px"
                  value={guide.margin[marginIndex] ?? 0}
                  min={0}
                  max={1000}
                  onChange={(value) => {
                    const margin = [...guide.margin] as LayoutGrid['margin'];
                    margin[marginIndex] = value;
                    updateGuide(guide, { margin });
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              className="insp-btn"
              onClick={() => removeLayoutGrid(node.id, guide.id)}
              aria-label={`Remove ${guide.name ?? `layout guide ${index + 1}`}`}
            >
              Remove guide
            </button>
          </fieldset>
        ))}
      </div>
    </DisclosureSection>
  );
}

/**
 * ClampSizingControls — min/preferred/max width/height for clamp() fluid sizing.
 * Also surfaces per-child sizing mode (fixed/hug/fill) for a frame's own
 * content bounds. Grid item placement is rendered by GridPlacementFields so it
 * can be gated by the selected node's actual parent.
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
    setSelectedLayoutRelativeWidth,
    setSelectedLayoutRelativeHeight,
    clearSelectedMinWidth,
    clearSelectedMaxWidth,
    clearSelectedMinHeight,
    clearSelectedMaxHeight,
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
  const relativeWRaw = commonValue(nodes, (n) => n.layoutRelativeWidth);
  const relativeHRaw = commonValue(nodes, (n) => n.layoutRelativeHeight);
  const widthIsFixed = !isMixed(widthSizingRaw) && widthSizingRaw === 'fixed';
  const heightIsFixed = !isMixed(heightSizingRaw) && heightSizingRaw === 'fixed';
  const draftKey = nodes
    .map((node) => node.id)
    .sort()
    .join(',');
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
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Min W"
          unit="px"
          value={isMixed(minWRaw) ? 0 : (minWRaw ?? 0)}
          mixed={isMixed(minWRaw)}
          min={0}
          disabled={widthIsFixed}
          draftKey={`${draftKey}:min-width`}
          onChange={setSelectedMinWidth}
        />
        <NumberField
          label="Max W"
          unit="px"
          value={isMixed(maxWRaw) ? 0 : (maxWRaw ?? 0)}
          mixed={isMixed(maxWRaw)}
          min={0}
          disabled={widthIsFixed}
          draftKey={`${draftKey}:max-width`}
          onChange={setSelectedMaxWidth}
        />
      </InspectorFieldGroup>
      {(minWRaw != null || maxWRaw != null) && (
        <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
          {minWRaw != null && (
            <button
              type="button"
              className="insp-btn insp-btn--compact"
              onClick={clearSelectedMinWidth}
              aria-label="Clear min width"
            >
              Clear min W
            </button>
          )}
          {maxWRaw != null && (
            <button
              type="button"
              className="insp-btn insp-btn--compact"
              onClick={clearSelectedMaxWidth}
              aria-label="Clear max width"
            >
              Clear max W
            </button>
          )}
        </div>
      )}
      <InspectorFieldGroup columns={2}>
        <NumberField
          label="Min H"
          unit="px"
          value={isMixed(minHRaw) ? 0 : (minHRaw ?? 0)}
          mixed={isMixed(minHRaw)}
          min={0}
          disabled={heightIsFixed}
          draftKey={`${draftKey}:min-height`}
          onChange={setSelectedMinHeight}
        />
        <NumberField
          label="Max H"
          unit="px"
          value={isMixed(maxHRaw) ? 0 : (maxHRaw ?? 0)}
          mixed={isMixed(maxHRaw)}
          min={0}
          disabled={heightIsFixed}
          draftKey={`${draftKey}:max-height`}
          onChange={setSelectedMaxHeight}
        />
      </InspectorFieldGroup>
      {(minHRaw != null || maxHRaw != null) && (
        <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
          {minHRaw != null && (
            <button
              type="button"
              className="insp-btn insp-btn--compact"
              onClick={clearSelectedMinHeight}
              aria-label="Clear min height"
            >
              Clear min H
            </button>
          )}
          {maxHRaw != null && (
            <button
              type="button"
              className="insp-btn insp-btn--compact"
              onClick={clearSelectedMaxHeight}
              aria-label="Clear max height"
            >
              Clear max H
            </button>
          )}
        </div>
      )}
      {(widthIsFixed || heightIsFixed) && (
        <p className="insp-panel__color-mode-note" role="note">
          Fixed axes keep their constraints for later mode changes, but the bounds are inactive
          while Fixed.
        </p>
      )}
      {!isMixed(widthSizingRaw) && widthSizingRaw === 'relative' && (
        <NumberField
          label="Width share"
          unit="%"
          value={isMixed(relativeWRaw) ? 0 : (relativeWRaw ?? 100)}
          mixed={isMixed(relativeWRaw)}
          min={0}
          step={0.1}
          draftKey={`${draftKey}:relative-width`}
          onChange={setSelectedLayoutRelativeWidth}
        />
      )}
      {!isMixed(heightSizingRaw) && heightSizingRaw === 'relative' && (
        <NumberField
          label="Height share"
          unit="%"
          value={isMixed(relativeHRaw) ? 0 : (relativeHRaw ?? 100)}
          mixed={isMixed(relativeHRaw)}
          min={0}
          step={0.1}
          draftKey={`${draftKey}:relative-height`}
          onChange={setSelectedLayoutRelativeHeight}
        />
      )}
    </div>
  );
}
