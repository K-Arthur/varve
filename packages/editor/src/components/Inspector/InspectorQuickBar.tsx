/**
 * InspectorQuickBar — compact access to the properties edited most often.
 *
 * This is a second access surface for the existing selection commands, not a
 * second property model. The full Layout, Appearance, and Fills sections stay
 * canonical; the quick bar simply keeps their high-frequency values in reach
 * at the top of the Properties surface.
 */
import type { Fill, ManagedColor, SceneNode } from '@varve/scene';
import { primaryColor, resolveNodeFills } from '@varve/scene';
import { formatCoordForRuler, managedColorToRgba } from '@varve/shared';
import { SemanticIcon, Tooltip } from '@varve/ui';
import { useCallback, useMemo } from 'react';
import { useEditor } from '../../context';
import { docVariableStore } from '../../docVariableStore';
import { nodeLocalBounds } from '../../scene/nodeBounds';
import { deriveNumericBindingPresentation } from './boundPropertyState';
import { FieldRow, InspectorFieldGroup } from './controls/FieldRow';
import { InspectorColorPopover } from './controls/InspectorColorPopover';
import { NumberField } from './controls/NumberField';
import { classifySelectionProperty } from './propertyState';

interface ColorFillTarget {
  index: number;
  color: ManagedColor;
}

function formatQuickValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return String(Math.round(value * 100) / 100);
}

function findColorFill(fills: Fill[]): ColorFillTarget | null {
  for (let index = fills.length - 1; index >= 0; index -= 1) {
    const fill = fills[index];
    if (!fill || fill.visible === false) continue;
    if (fill.type === 'solid' && fill.color) return { index, color: fill.color };
    if (fill.type === 'gradient' && fill.gradient?.stops[0]) {
      return { index, color: fill.gradient.stops[0].color };
    }
  }
  return null;
}

function fillPreview(
  fill: Fill | undefined,
  documentAssets: Record<string, { dataUrl?: string }>,
): React.CSSProperties {
  if (!fill) return { background: 'var(--color-surface-sunken)' };
  if (fill.type === 'solid' && fill.color) {
    const [r, g, b, a] = managedColorToRgba(fill.color);
    return { background: `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})` };
  }
  if (fill.type === 'gradient' && fill.gradient) {
    const stops = fill.gradient.stops
      .map((stop) => {
        const [r, g, b, a] = managedColorToRgba(stop.color);
        return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)}) ${(stop.position * 100).toFixed(0)}%`;
      })
      .join(', ');
    return { background: `linear-gradient(90deg, ${stops})` };
  }
  if (fill.type === 'image') {
    const source = fill.image?.src ?? '';
    const assetId = source.startsWith('asset:')
      ? source.slice('asset:'.length)
      : fill.image?.assetId;
    const assetSource = assetId ? documentAssets[assetId]?.dataUrl : undefined;
    const resolved = assetSource ?? source;
    if (resolved && !resolved.startsWith('asset:')) {
      return { background: `url(${resolved}) center / cover` };
    }
  }
  return { background: 'var(--color-surface-sunken)' };
}

function updateGradientFirstStop(fill: Fill, color: ManagedColor): Fill {
  if (fill.type !== 'gradient' || !fill.gradient || fill.gradient.stops.length === 0) {
    return fill;
  }
  const first = fill.gradient.stops[0];
  if (!first) return fill;
  const rest = fill.gradient.stops.slice(1);
  return {
    ...fill,
    gradient: {
      ...fill.gradient,
      stops: [{ ...first, color }, ...rest],
    },
  };
}

function fillSummary(fill: Fill | undefined): string {
  if (!fill) return 'No fill';
  switch (fill.type) {
    case 'solid':
      return 'Solid';
    case 'gradient':
      return 'Gradient';
    case 'image':
      return 'Image';
    case 'pattern':
      return 'Pattern';
    default:
      return 'Fill';
  }
}

export function InspectorQuickBar({ node }: { node: SceneNode }) {
  const editor = useEditor();
  const doc = editor.state.document;
  const variableStore = docVariableStore(doc);
  const draftKey = `${doc.id}:${node.id}:quick-properties`;
  const bounds = useMemo(() => nodeLocalBounds(node, doc), [node, doc]);
  const fills = useMemo(() => resolveNodeFills(node), [node]);
  const fillTarget = useMemo(() => findColorFill(fills), [fills]);
  const fill = fillTarget ? fills[fillTarget.index] : fills.at(-1);
  const color = fillTarget?.color ?? primaryColor(fills);

  const activePage = doc.pages?.find((page) => page.id === doc.activePageId);
  const artboard = activePage ? { x: 0, y: 0, w: activePage.width, h: activePage.height } : null;
  const useArtboardCoords = editor.state.rulerMode === 'artboard' && artboard !== null;

  const xRaw = node.transform[4] ?? 0;
  const yRaw = node.transform[5] ?? 0;
  const xBinding = deriveNumericBindingPresentation([node], 'x', [xRaw], variableStore);
  const yBinding = deriveNumericBindingPresentation([node], 'y', [yRaw], variableStore);
  const widthRaw = bounds?.w ?? 0;
  const heightRaw = bounds?.h ?? 0;
  const widthBinding = deriveNumericBindingPresentation([node], 'width', [widthRaw], variableStore);
  const heightBinding = deriveNumericBindingPresentation(
    [node],
    'height',
    [heightRaw],
    variableStore,
  );
  const opacityRaw = node.opacity ?? 1;
  const opacityBinding = deriveNumericBindingPresentation(
    [node],
    'opacity',
    [opacityRaw],
    variableStore,
  );
  const xState = xBinding?.state ?? classifySelectionProperty([xRaw]);
  const yState = yBinding?.state ?? classifySelectionProperty([yRaw]);
  const widthState = widthBinding?.state ?? classifySelectionProperty([widthRaw]);
  const heightState = heightBinding?.state ?? classifySelectionProperty([heightRaw]);
  const opacityState = opacityBinding?.state ?? classifySelectionProperty([opacityRaw]);
  const preserveAspectRatio =
    node.kind === 'shape' &&
    node.fills?.some((fill) => fill.type === 'image' || fill.type === 'pattern');
  const aspectRatio = bounds && bounds.h !== 0 ? bounds.w / bounds.h : null;

  const toDisplayX = useArtboardCoords
    ? formatCoordForRuler(
        xBinding?.value ?? xRaw,
        'x',
        'artboard',
        artboard,
        activePage?.rulerOrigin ? [activePage.rulerOrigin.x, activePage.rulerOrigin.y] : undefined,
      )
    : (xBinding?.value ?? xRaw);
  const toDisplayY = useArtboardCoords
    ? formatCoordForRuler(
        yBinding?.value ?? yRaw,
        'y',
        'artboard',
        artboard,
        activePage?.rulerOrigin ? [activePage.rulerOrigin.x, activePage.rulerOrigin.y] : undefined,
      )
    : (yBinding?.value ?? yRaw);
  const fromDisplayX = (value: number) =>
    useArtboardCoords && artboard ? value + artboard.x + (activePage?.rulerOrigin?.x ?? 0) : value;
  const fromDisplayY = (value: number) =>
    useArtboardCoords && artboard ? value + artboard.y + (activePage?.rulerOrigin?.y ?? 0) : value;

  const handleColorChange = useCallback(
    (next: ManagedColor) => {
      if (!fillTarget || !fill) {
        editor.setSelectedFill(next);
        return;
      }
      if (fill.type === 'solid') {
        editor.updateSelectedFillAt(fillTarget.index, { ...fill, color: next });
        return;
      }
      editor.updateSelectedFillAt(fillTarget.index, updateGradientFirstStop(fill, next));
    },
    [editor, fill, fillTarget],
  );
  const handleWidthChange = useCallback(
    (width: number) => {
      editor.beginTransaction();
      editor.setSelectedW(width);
      if (preserveAspectRatio && aspectRatio !== null) {
        editor.setSelectedH(width / aspectRatio);
      }
      editor.commitTransaction();
    },
    [aspectRatio, editor, preserveAspectRatio],
  );
  const handleHeightChange = useCallback(
    (height: number) => {
      editor.beginTransaction();
      editor.setSelectedH(height);
      if (preserveAspectRatio && aspectRatio !== null) {
        editor.setSelectedW(height * aspectRatio);
      }
      editor.commitTransaction();
    },
    [aspectRatio, editor, preserveAspectRatio],
  );

  return (
    <section
      className="insp-quick-bar"
      aria-labelledby="insp-quick-bar-title"
      data-testid="inspector-quick-bar"
    >
      <div className="insp-quick-bar__heading">
        <div className="insp-quick-bar__title">
          <SemanticIcon name="Transform" size="sm" aria-hidden="true" />
          <h2 id="insp-quick-bar-title">Quick properties</h2>
        </div>
        <span className="insp-quick-bar__meta">1 selected</span>
      </div>
      <div className="insp-quick-bar__groups">
        <fieldset className="insp-quick-bar__group">
          <legend>
            <SemanticIcon name="Ruler" size="xs" aria-hidden="true" />
            <span>Position</span>
          </legend>
          <InspectorFieldGroup columns={2} className="insp-quick-bar__fields">
            <NumberField
              label={useArtboardCoords ? 'X (AB)' : 'X'}
              displayLabel="X"
              unit="px"
              value={toDisplayX}
              formatValue={formatQuickValue}
              propertyState={xState}
              readOnly={xBinding?.readOnly ?? false}
              bindingLabel={xBinding?.sourceLabel}
              onUnbind={xBinding ? () => editor.setSelectedBinding('x', null) : undefined}
              draftKey={draftKey}
              fieldName="x"
              onShiftClick={() => editor.setBindingField('x')}
              onChange={(value) => editor.setSelectedX(fromDisplayX(value))}
            />
            <NumberField
              label={useArtboardCoords ? 'Y (AB)' : 'Y'}
              displayLabel="Y"
              unit="px"
              value={toDisplayY}
              formatValue={formatQuickValue}
              propertyState={yState}
              readOnly={yBinding?.readOnly ?? false}
              bindingLabel={yBinding?.sourceLabel}
              onUnbind={yBinding ? () => editor.setSelectedBinding('y', null) : undefined}
              draftKey={draftKey}
              fieldName="y"
              onShiftClick={() => editor.setBindingField('y')}
              onChange={(value) => editor.setSelectedY(fromDisplayY(value))}
            />
          </InspectorFieldGroup>
        </fieldset>
        <fieldset className="insp-quick-bar__group">
          <legend>
            <SemanticIcon name="Scale" size="xs" aria-hidden="true" />
            <span>Size</span>
          </legend>
          <InspectorFieldGroup columns={2} className="insp-quick-bar__fields">
            <NumberField
              label="Width"
              displayLabel="W"
              unit="px"
              value={widthBinding?.value ?? widthRaw}
              formatValue={formatQuickValue}
              disabled={!bounds}
              propertyState={widthState}
              readOnly={widthBinding?.readOnly ?? false}
              bindingLabel={widthBinding?.sourceLabel}
              onUnbind={widthBinding ? () => editor.setSelectedBinding('width', null) : undefined}
              draftKey={draftKey}
              fieldName="width"
              onShiftClick={() => editor.setBindingField('width')}
              onChange={handleWidthChange}
            />
            <NumberField
              label="Height"
              displayLabel="H"
              unit="px"
              value={heightBinding?.value ?? heightRaw}
              formatValue={formatQuickValue}
              disabled={!bounds}
              propertyState={heightState}
              readOnly={heightBinding?.readOnly ?? false}
              bindingLabel={heightBinding?.sourceLabel}
              onUnbind={heightBinding ? () => editor.setSelectedBinding('height', null) : undefined}
              draftKey={draftKey}
              fieldName="height"
              onShiftClick={() => editor.setBindingField('height')}
              onChange={handleHeightChange}
            />
          </InspectorFieldGroup>
        </fieldset>
        <fieldset className="insp-quick-bar__group">
          <legend>
            <SemanticIcon name="Palette" size="xs" aria-hidden="true" />
            <span>Appearance</span>
          </legend>
          <InspectorFieldGroup columns={2} className="insp-quick-bar__fields">
            <NumberField
              label="Opacity"
              displayLabel="Opacity"
              value={(opacityBinding?.value ?? opacityRaw) * 100}
              formatValue={formatQuickValue}
              unit="%"
              min={0}
              max={100}
              step={1}
              propertyState={opacityState}
              readOnly={opacityBinding?.readOnly ?? false}
              bindingLabel={opacityBinding?.sourceLabel}
              onUnbind={
                opacityBinding ? () => editor.setSelectedBinding('opacity', null) : undefined
              }
              draftKey={draftKey}
              fieldName="opacity"
              onShiftClick={() => editor.setBindingField('opacity')}
              onChange={(value) => editor.setSelectedOpacity(value / 100)}
            />
            <FieldRow label="Fill">
              <div className="insp-quick-bar__fill-control">
                {color ? (
                  <InspectorColorPopover
                    label="Primary fill colour"
                    tooltipLabel="Edit primary fill"
                    value={color}
                    onChange={handleColorChange}
                    swatchStyle={fillPreview(fill, doc.assets ?? {})}
                    documentColorMode={editor.documentColorMode}
                    onEditStart={editor.beginTransaction}
                    onEditEnd={editor.commitTransaction}
                  />
                ) : (
                  <Tooltip label="The selected object has no editable colour fill">
                    <button
                      type="button"
                      className="insp-swatch insp-quick-bar__fill-swatch"
                      aria-label="Fill colour unavailable"
                      disabled
                    />
                  </Tooltip>
                )}
                <output className="insp-quick-bar__fill-summary">{fillSummary(fill)}</output>
              </div>
            </FieldRow>
          </InspectorFieldGroup>
        </fieldset>
      </div>
      {editor.bindingField &&
        ['x', 'y', 'width', 'height', 'opacity'].includes(editor.bindingField) && (
          <p className="insp-quick-bar__hint">
            Shift-click a label to bind this property to a variable.
          </p>
        )}
    </section>
  );
}
