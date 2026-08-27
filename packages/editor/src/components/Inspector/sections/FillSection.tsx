/**
 * FillSection — stacked fill controls for the Inspector.
 *
 * Supports solid, gradient (linear/radial/angular/diamond), image, and pattern
 * fills. Fills are stacked (paint order bottom to top), reorderable via drag,
 * with per-fill opacity, blend mode, visibility toggle, and delete.
 *
 * Multi-select: matches fills by index across selected nodes, shows "Mixed" for
 * differing properties. Edits batch across all selected in one undo step via
 * the transaction API.
 *
 * Research basis: Figma/Sketch fill panel; APG Disclosure, Listbox, Slider.
 */
import { complementaryHarmony } from '@varve/engine';
import type {
  BlendMode,
  Fill,
  FillType,
  GradientFill,
  GradientStop,
  ImageFillData,
  ManagedColor,
  PatternFillData,
  SceneNode,
} from '@varve/scene';
import {
  alphaModifierLabel,
  createEmbeddedAsset,
  gradientFill,
  imageFill,
  patternFill,
  resolveBoundTokenColor,
  resolveNodeFills,
  solidFill,
} from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { Icon, Select, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { docVariableStore } from '../../../docVariableStore';
import { GradientEditor } from '../color/GradientEditor';
import {
  resolvedGradientHueInterpolation,
  resolvedGradientInterpolationSpace,
} from '../color/gradientUiState';
import { BindingMenu } from '../controls/BindingMenu';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';
import { NumberField } from '../controls/NumberField';
import type { SegmentedOption } from '../controls/SegmentedControl';
import { VariableModifierPopover } from '../controls/VariableModifierPopover';
import { commonValue, isMixed } from '../selection/selectionState';
import { FillContrastIndicator } from './FillContrastIndicator';
import { ImageFillControls } from './ImageFillControls';
import { PatternFillControls } from './PatternFillControls';

export interface FillSectionProps {
  nodes: SceneNode[];
}

interface FillModifierState {
  binding: import('@varve/scene').PropertyBinding;
  tokenColor: import('@varve/scene').ManagedColor;
  modifiers: import('@varve/scene').AlphaModifier[];
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  variableName: string;
}

const BLEND_OPTIONS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'colorDodge', label: 'Color Dodge' },
  { value: 'colorBurn', label: 'Color Burn' },
  { value: 'hardLight', label: 'Hard Light' },
  { value: 'softLight', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
  { value: 'plusDarker', label: 'Plus Darker' },
  { value: 'plusLighter', label: 'Plus Lighter' },
  { value: 'passThrough', label: 'Pass Through' },
];

const FILL_TYPE_OPTIONS: SegmentedOption<FillType>[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image', label: 'Image' },
  { value: 'pattern', label: 'Pattern' },
];

type AddFillKind = 'solid' | 'linear' | 'radial' | 'image' | 'pattern';

const ADD_FILL_OPTIONS: { kind: AddFillKind; label: string; icon: string }[] = [
  { kind: 'solid', label: 'Solid', icon: 'Square' },
  { kind: 'linear', label: 'Linear gradient', icon: 'ArrowDown' },
  { kind: 'radial', label: 'Radial gradient', icon: 'Circle' },
  { kind: 'image', label: 'Image', icon: 'Image' },
  { kind: 'pattern', label: 'Pattern', icon: 'LayoutGrid' },
];

/**
 * Default gradient stops seeded from the source fill's own colour instead of
 * an arbitrary brand teal/blue: stop 0 keeps the user's current solid and
 * stop 1 is a deterministic harmony (complementary) derivation of it. The
 * first frame after Solid → Gradient therefore changes visibly while
 * preserving the user's chosen hue.
 */
function defaultGradientStops(source: Fill | undefined): GradientStop[] {
  let base: ManagedColor | undefined;
  if (source?.type === 'solid') base = source.color;
  else if (source?.type === 'gradient') base = source.gradient?.stops[0]?.color;
  if (!base) {
    base = { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 };
  }
  const [r, g, b, a] = managedColorToRgba(base);
  const start: ManagedColor = { space: 'rgb' as const, r, g, b, a };
  const harmony = complementaryHarmony(start);
  const rawEnd = harmony.colors.length > 0 ? harmony.colors[0] : undefined;
  let endColor: ManagedColor;
  if (rawEnd && 'space' in rawEnd) {
    const [er, eg, eb, ea] = managedColorToRgba(rawEnd);
    endColor = { space: 'rgb' as const, r: er, g: eg, b: eb, a: ea };
    if (er === r && eg === g && eb === b) {
      // Harmony of an achromatic source returns itself; derive a darkening
      // stop instead so the gradient is still visibly not flat.
      endColor = {
        space: 'rgb' as const,
        r: Math.round(r * 0.5),
        g: Math.round(g * 0.5),
        b: Math.round(b * 0.5),
        a,
      };
    }
  } else {
    endColor = {
      space: 'rgb' as const,
      r: Math.max(0, r - 80),
      g: Math.max(0, g - 80),
      b: Math.max(0, b - 80),
      a,
    };
  }
  return [
    { position: 0, color: start },
    { position: 1, color: endColor },
  ];
}

/** Build a new fill for the "+ Add fill" menu. */
function buildNewFill(kind: AddFillKind, source: Fill | undefined): Fill {
  switch (kind) {
    case 'solid':
      return solidFill({ space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 });
    case 'linear':
    case 'radial':
      return gradientFill(kind === 'linear' ? 'linear' : 'radial', defaultGradientStops(source));
    case 'image':
      return imageFill('');
    case 'pattern':
      return patternFill('');
  }
}

function fillSwatchBg(fill: Fill): string {
  if (fill.type === 'solid' && fill.color) {
    const [r, g, b, a] = managedColorToRgba(fill.color);
    return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
  }
  if (fill.type === 'gradient' && fill.gradient) {
    const stops = fill.gradient.stops
      .map((s) => {
        const [r, g, b, a] = managedColorToRgba(s.color);
        return `rgba(${r},${g},${b},${(a / 255).toFixed(2)}) ${(s.position * 100).toFixed(0)}%`;
      })
      .join(', ');
    return `linear-gradient(90deg, ${stops})`;
  }
  if (fill.type === 'image') {
    const src = fill.image?.src;
    if (src) return `url(${src}) center/cover`;
    return 'var(--color-surface-sunken)';
  }
  return 'var(--color-surface-sunken)';
}

export function FillSection({ nodes }: FillSectionProps) {
  const editor = useEditor();
  const {
    addSelectedFill,
    updateSelectedFillAt,
    removeSelectedFillAt,
    reorderSelectedFill,
    beginTransaction,
    commitTransaction,
    announce,
  } = editor;
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [fillModifierState, setFillModifierState] = useState<FillModifierState | null>(null);
  const modifierAnchorRef = useRef<HTMLButtonElement | null>(null);
  const bindingTriggerRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addTriggerRef = useRef<HTMLButtonElement>(null);

  const fills = useMemo(() => {
    const all = nodes.map((n) => resolveNodeFills(n));
    if (all.length === 0) return [];
    const minLen = Math.min(...all.map((f) => f.length));
    return Array.from({ length: minLen }, (_, i) => all[0]?.[i] ?? all[0]?.[0]) as Fill[];
  }, [nodes]);

  const countMixed = nodes.some((n) => resolveNodeFills(n).length !== fills.length);

  const updateFill = useCallback(
    (index: number, fill: Fill) => {
      updateSelectedFillAt(index, fill);
    },
    [updateSelectedFillAt],
  );

  const addFill = useCallback(
    (kind: AddFillKind) => {
      const fill = buildNewFill(kind, fills[0]);
      addSelectedFill(fill);
      announce('Fill added');
    },
    [fills, addSelectedFill, announce],
  );

  const removeFill = useCallback(
    (index: number) => {
      removeSelectedFillAt(index);
      announce('Fill removed');
    },
    [removeSelectedFillAt, announce],
  );

  const reorderFill = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      beginTransaction();
      reorderSelectedFill(from, to);
      commitTransaction();
    },
    [beginTransaction, commitTransaction, reorderSelectedFill],
  );

  // Close the add-fill menu on outside pointerdown or Escape.
  useEffect(() => {
    if (!addMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!addMenuRef.current?.contains(target) && !addTriggerRef.current?.contains(target)) {
        setAddMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAddMenuOpen(false);
        addTriggerRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [addMenuOpen]);

  return (
    <DisclosureSection title="Fill" sectionId="fills">
      {fills.length === 0 && <div className="insp-empty-message">No fill</div>}
      <div ref={bindingTriggerRef} className="insp-field-group">
        {fills.map((fill, i) => (
          <FillRow
            // biome-ignore lint/suspicious/noArrayIndexKey: fill rows have no stable id in the document model; index identifies the slot
            key={i}
            index={i}
            fill={fill}
            nodes={nodes}
            onChange={(f) => updateFill(i, f)}
            onRemove={() => removeFill(i)}
            onReorder={(dir) => reorderFill(i, i + dir)}
            canMoveUp={i > 0}
            canMoveDown={i < fills.length - 1}
            onEditStart={beginTransaction}
            onEditEnd={commitTransaction}
            binding={
              i === 0
                ? (nodes[0]?.bindings?.fill as import('@varve/scene').PropertyBinding | undefined)
                : undefined
            }
            modifierAnchorRef={modifierAnchorRef}
            onOpenModifier={() => {
              const binding = nodes[0]?.bindings?.fill;
              if (!binding) return;
              const store = docVariableStore(editor.state.document);
              const tokenColor = resolveBoundTokenColor(store, binding);
              if (!tokenColor) return;
              const variableName = store.variables[binding.variableId]?.name ?? binding.variableId;
              setFillModifierState({
                binding,
                tokenColor,
                modifiers: (binding.modifiers ?? []).filter(
                  (m): m is import('@varve/scene').AlphaModifier => m.kind === 'alpha',
                ),
                anchorRef: modifierAnchorRef,
                variableName,
              });
            }}
          />
        ))}
      </div>
      {countMixed && fills.length > 0 && (
        <div className="insp-empty-message">Some selected nodes have additional fills</div>
      )}
      <div className="insp-fill-add">
        <div className="insp-fill-add__controls">
          <button
            ref={addTriggerRef}
            type="button"
            className="insp-add-btn insp-fill-add__trigger"
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
            onClick={() => setAddMenuOpen((v) => !v)}
          >
            <Icon name="Plus" label={undefined} size="0.85em" />
            <span>Add fill</span>
          </button>
          {addMenuOpen && (
            <div ref={addMenuRef} role="menu" aria-label="Add fill" className="insp-fill-add__menu">
              {ADD_FILL_OPTIONS.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  role="menuitem"
                  className="insp-fill-add__menu-item"
                  onClick={() => {
                    setAddMenuOpen(false);
                    addFill(opt.kind);
                  }}
                >
                  <Icon
                    name={opt.icon as import('@varve/ui').IconName}
                    label={undefined}
                    size="0.85em"
                  />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {editor.bindingField === 'fill' && (
        <BindingMenu
          variableStore={docVariableStore(editor.state.document)}
          targetType="color"
          onBind={(variableId, expression) => {
            editor.setSelectedBinding('fill', { variableId, expression });
            editor.setBindingField(null);
          }}
          onClose={() => editor.setBindingField(null)}
          triggerRef={bindingTriggerRef}
        />
      )}
      {fillModifierState && (
        <VariableModifierPopover
          tokenColor={fillModifierState.tokenColor}
          modifiers={fillModifierState.modifiers}
          anchorRef={fillModifierState.anchorRef}
          onCommit={(modifiers) => {
            const binding = fillModifierState.binding;
            if (modifiers) {
              editor.setSelectedBinding('fill', { ...binding, modifiers });
            } else {
              const { modifiers: _drop, ...rest } = binding;
              editor.setSelectedBinding('fill', rest);
            }
            editor.announce(modifiers ? 'Alpha modifier applied' : 'Alpha modifier reset');
          }}
          onClose={() => setFillModifierState(null)}
        />
      )}
    </DisclosureSection>
  );
}

interface FillRowProps {
  index: number;
  fill: Fill;
  nodes: SceneNode[];
  onChange: (fill: Fill) => void;
  onRemove: () => void;
  onReorder: (dir: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  /** V2.15+: the node's fill variable binding (badge + modifier popover). */
  binding?: import('@varve/scene').PropertyBinding;
  modifierAnchorRef?: React.RefObject<HTMLButtonElement | null>;
  onOpenModifier?: () => void;
}

function FillRow({
  index,
  fill,
  nodes,
  onChange,
  onRemove,
  onReorder,
  canMoveUp,
  canMoveDown,
  onEditStart,
  onEditEnd,
  binding,
  modifierAnchorRef,
  onOpenModifier,
}: FillRowProps) {
  const editor = useEditor();
  const label = index === 0 ? 'Fill' : `Fill ${index + 1}`;
  const bindingStore = docVariableStore(editor.state.document);
  const bindingVariableName = binding
    ? (bindingStore.variables[binding.variableId]?.name ?? binding.variableId)
    : null;
  const bindingModifierLabel = binding?.modifiers?.[0]
    ? alphaModifierLabel(binding.modifiers[0])
    : null;
  const bindingValid = binding ? resolveBoundTokenColor(bindingStore, binding) !== undefined : true;

  const visibleRaw = commonValue(nodes, (n) => resolveNodeFills(n)[index]?.visible ?? true);
  const typeRaw = commonValue(nodes, (n) => resolveNodeFills(n)[index]?.type ?? 'solid');
  const opacityRaw = commonValue(nodes, (n) => resolveNodeFills(n)[index]?.opacity ?? 1);
  const blendRaw = commonValue(nodes, (n) => resolveNodeFills(n)[index]?.blendMode ?? 'normal');
  const documentGradientInterpolation =
    editor.state.document.colorConfig?.defaultGradientInterpolation ?? 'oklab';

  // Gradient interpolation/hue are sub-fields; surface "Mixed" across the
  // selection using resolved semantics. A legacy gradient (missing metadata)
  // is sRGB, while interpolationSource=document inherits the document value.
  const interpRaw = commonValue(nodes, (n) =>
    resolvedGradientInterpolationSpace(
      resolveNodeFills(n)[index]?.gradient,
      documentGradientInterpolation,
    ),
  );
  const hueRaw = commonValue(nodes, (n) =>
    resolvedGradientHueInterpolation(
      resolveNodeFills(n)[index]?.gradient,
      documentGradientInterpolation,
    ),
  );
  const gradientInterpMixed = isMixed(interpRaw);
  const gradientHueMixed = isMixed(hueRaw);
  const representativeGradient =
    fill?.gradient ?? (nodes[0] ? resolveNodeFills(nodes[0])[index]?.gradient : undefined);
  const allGradients = !isMixed(typeRaw) && typeRaw === 'gradient';

  const visible = isMixed(visibleRaw) ? true : visibleRaw;
  const swatchBg = fillSwatchBg(fill);

  const patch = useCallback(
    (partial: Partial<Fill>) => onChange({ ...fill, ...partial }),
    [fill, onChange],
  );

  const setFillType = useCallback(
    (newType: FillType) => {
      if (newType === 'solid') {
        const firstStop =
          fill.type === 'gradient' && fill.gradient?.stops[0]
            ? fill.gradient.stops[0].color
            : undefined;
        patch({
          type: 'solid',
          color:
            fill.color ??
            (firstStop
              ? ({ ...firstStop } as ManagedColor)
              : { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 }),
        });
      } else if (newType === 'gradient') {
        patch({
          type: 'gradient',
          gradient: fill.gradient ?? {
            type: 'linear',
            stops: defaultGradientStops(fill),
            interpolationSource: 'document',
          },
        });
      } else if (newType === 'image') {
        patch({
          type: 'image',
          image: fill.image ?? { src: '', fit: 'fill', x: 0, y: 0, scale: 1 },
        });
      } else if (newType === 'pattern') {
        patch({
          type: 'pattern',
          pattern: fill.pattern ?? { tileSrc: '', spacing: 0, rotation: 0 },
        });
      }
    },
    [fill, patch],
  );

  return (
    <div className="insp-fill-row">
      <div className="insp-field">
        <button
          type="button"
          className="insp-inline-btn"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
          onClick={() => patch({ visible: !visible })}
        >
          <Icon name={visible ? 'Eye' : 'EyeOff'} label={undefined} size="0.85em" />
        </button>
        {fill.type === 'solid' && fill.color ? (
          <InspectorColorPopover
            label={`${label} colour`}
            value={fill.color}
            onChange={(c) => patch({ color: c })}
            swatchStyle={{
              background: swatchBg,
              border: '2px solid var(--color-border-strong)',
            }}
            documentColorMode={editor.documentColorMode}
            onEditStart={onEditStart}
            onEditEnd={onEditEnd}
          />
        ) : (
          <button
            type="button"
            className="insp-swatch"
            aria-label={`${label} preview`}
            disabled
            style={{
              background: swatchBg,
              border: '2px solid var(--color-border-strong)',
            }}
          />
        )}
        {fill.type === 'solid' && fill.color && (
          <FillContrastIndicator
            fill={fill}
            fillIndex={index}
            fontSize={
              nodes.length === 1 && nodes[0]?.kind === 'text'
                ? (nodes[0] as import('@varve/scene').TextNode).fontSize
                : undefined
            }
            fontWeight={
              nodes.length === 1 && nodes[0]?.kind === 'text'
                ? (nodes[0] as import('@varve/scene').TextNode).fontWeight
                : undefined
            }
          />
        )}
        {!binding && (
          <button
            type="button"
            className="insp-inline-btn"
            aria-label="Link fill to a variable"
            title="Link fill to a variable"
            onClick={() => editor.setBindingField('fill')}
          >
            <Icon name="Link" label={undefined} size="0.9em" />
          </button>
        )}
        {binding && onOpenModifier && (
          <button
            type="button"
            ref={modifierAnchorRef}
            className="varve-binding-badge"
            aria-label={
              bindingValid
                ? 'Linked to ' +
                  (bindingVariableName ?? '') +
                  (bindingModifierLabel ? `, alpha ${bindingModifierLabel}` : '')
                : `Variable ${bindingVariableName ?? ''} is missing or invalid`
            }
            title={
              bindingValid
                ? 'Linked to $' +
                  bindingVariableName +
                  (bindingModifierLabel ? ` · ${bindingModifierLabel}` : '')
                : 'Linked variable is missing or invalid — binding preserved'
            }
            style={{
              fontSize: 11,
              padding: '2px 6px',
              borderRadius: 4,
              border:
                '1px solid ' +
                (bindingValid
                  ? 'var(--color-accent-primary, #39d0c6)'
                  : 'var(--color-feedback-danger, #d64545)'),
              color: bindingValid
                ? 'var(--color-text-primary, #292d36)'
                : 'var(--color-feedback-danger, #d64545)',
              background: bindingValid
                ? 'var(--color-surface-raised, #fff)'
                : 'rgba(214,69,69,0.08)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              cursor: 'pointer',
            }}
            onClick={onOpenModifier}
          >
            <span>${bindingVariableName}</span>
            {bindingModifierLabel && <strong>{bindingModifierLabel}</strong>}
            {!bindingValid && <span>(invalid)</span>}
          </button>
        )}
        {fill.type === 'solid' && fill.color && fill.color.space === 'rgb' && (
          <Tooltip label="Generate harmony colors">
            <button
              type="button"
              className="insp-inline-btn"
              aria-label="Generate harmony colors"
              onClick={() => {
                const pal = complementaryHarmony(fill.color!);
                if (pal.colors.length > 0) {
                  const harmonyColor = pal.colors[0];
                  if (harmonyColor && 'space' in harmonyColor) {
                    patch({ color: harmonyColor });
                  }
                }
              }}
            >
              <Icon name="Palette" label={undefined} size="0.85em" />
            </button>
          </Tooltip>
        )}
        <div className="insp-field__control">
          <Select
            label={`${label} type`}
            value={isMixed(typeRaw) ? '' : typeRaw}
            options={[
              ...(isMixed(typeRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
              ...FILL_TYPE_OPTIONS,
            ]}
            onChange={(v) => {
              if (v) setFillType(v as FillType);
            }}
            placeholder="Mixed"
          />
        </div>
        <button
          type="button"
          aria-label={`Move ${label} up`}
          disabled={!canMoveUp}
          onClick={() => onReorder(-1)}
          className="insp-inline-btn"
          style={{
            opacity: canMoveUp ? 1 : 0.3,
            cursor: canMoveUp ? 'pointer' : 'not-allowed',
          }}
        >
          <Icon name="ChevronUp" label={undefined} size="0.85em" />
        </button>
        <button
          type="button"
          aria-label={`Move ${label} down`}
          disabled={!canMoveDown}
          onClick={() => onReorder(1)}
          className="insp-inline-btn"
          style={{
            opacity: canMoveDown ? 1 : 0.3,
            cursor: canMoveDown ? 'pointer' : 'not-allowed',
          }}
        >
          <Icon name="ChevronDown" label={undefined} size="0.85em" />
        </button>
        <button
          type="button"
          className="insp-inline-btn"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <Icon name="X" label={undefined} size="0.85em" />
        </button>
      </div>

      {allGradients && representativeGradient && (
        <GradientEditor
          gradient={representativeGradient}
          onChange={(g: GradientFill) => editor.updateSelectedFillGradientAt(index, g)}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
          documentColorMode={editor.documentColorMode}
          documentGradientInterpolation={documentGradientInterpolation}
          mixedInterpolationSpace={gradientInterpMixed}
          mixedHue={gradientHueMixed}
        />
      )}

      {fill.type === 'image' && fill.image && (
        <ImageFillControls
          image={fill.image}
          onChange={(img: ImageFillData) => patch({ image: img })}
          registerAsset={(input) => {
            const asset = createEmbeddedAsset(input);
            // Dedup: if the asset already exists, reuse its id
            const existing = editor.state.document.assets?.[asset.id];
            if (!existing) {
              editor.updateDoc((doc) => ({
                ...doc,
                assets: { ...doc.assets, [asset.id]: asset },
              }));
            }
            return asset.id;
          }}
          onResetUpscale={
            fill.image?.upscale
              ? () => {
                  const image = fill.image as ImageFillData;
                  const sourceAssetId = image.upscale?.sourceAssetId;
                  if (!sourceAssetId) return;
                  const sourceAsset = editor.state.document.assets?.[sourceAssetId];
                  if (sourceAsset) {
                    patch({
                      image: {
                        ...image,
                        src: sourceAsset.dataUrl,
                        assetId: sourceAssetId,
                        upscale: undefined,
                      },
                    });
                  }
                }
              : undefined
          }
          onReUpscale={
            fill.image?.upscale
              ? () => {
                  editor.openUpscaleDialog();
                }
              : undefined
          }
          asset={
            fill.image.assetId ? editor.state.document.assets?.[fill.image.assetId] : undefined
          }
        />
      )}

      {fill.type === 'pattern' && fill.pattern && (
        <PatternFillControls
          pattern={fill.pattern}
          onChange={(p: PatternFillData) => patch({ pattern: p })}
        />
      )}

      <div className="insp-fill-row__properties">
        <NumberField
          label="Fill opacity"
          value={isMixed(opacityRaw) ? 1 : opacityRaw}
          mixed={isMixed(opacityRaw)}
          step={0.01}
          min={0}
          max={1}
          onChange={(v) => patch({ opacity: v })}
        />
        <FieldRow label="Blend mode">
          <Select
            label="Fill blend mode"
            value={isMixed(blendRaw) ? '' : blendRaw}
            options={[
              ...(isMixed(blendRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
              ...BLEND_OPTIONS,
            ]}
            onChange={(v) => {
              if (v) patch({ blendMode: v as BlendMode });
            }}
            placeholder="Mixed"
          />
        </FieldRow>
      </div>
    </div>
  );
}
