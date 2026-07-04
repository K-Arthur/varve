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
import type {
  BlendMode,
  Fill,
  FillType,
  GradientFill,
  ImageFillData,
  ManagedColor,
  PatternFillData,
  SceneNode,
} from '@strata/scene';
import { gradientFill, imageFill, patternFill, resolveNodeFills, solidFill } from '@strata/scene';
import { Icon } from '@strata/ui';
import { ColorPicker } from '@strata/ui/components/ColorPicker';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { GradientEditor } from '../color/GradientEditor';
import { BindingMenu } from '../controls/BindingMenu';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed } from '../selection/selectionState';
import { ImageFillControls } from './ImageFillControls';

export interface FillSectionProps {
  nodes: SceneNode[];
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

const FILL_TYPE_OPTIONS: { value: FillType; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image', label: 'Image' },
  { value: 'pattern', label: 'Pattern' },
];

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
  const [newFillType, setNewFillType] = useState<FillType>('solid');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set([0]));
  const [openPickerFor, setOpenPickerFor] = useState<number | null>(null);
  const bindingTriggerRef = useRef<HTMLDivElement>(null);

  const fills = useMemo(() => {
    const all = nodes.map((n) => resolveNodeFills(n));
    if (all.length === 0) return [];
    const minLen = Math.min(...all.map((f) => f.length));
    return Array.from({ length: minLen }, (_, i) => all[0]?.[i] ?? all[0]?.[0]) as Fill[];
  }, [nodes]);

  const countMixed = nodes.some((n) => resolveNodeFills(n).length !== fills.length);

  const toggleRow = useCallback((i: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const updateFill = useCallback(
    (index: number, fill: Fill) => {
      updateSelectedFillAt(index, fill);
    },
    [updateSelectedFillAt],
  );

  const addFill = useCallback(() => {
    let fill: Fill;
    switch (newFillType) {
      case 'gradient':
        fill = gradientFill('linear', [
          { position: 0, color: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 } },
          { position: 1, color: { space: 'rgb' as const, r: 37, g: 99, b: 235, a: 255 } },
        ]);
        break;
      case 'image':
        fill = imageFill('');
        break;
      case 'pattern':
        fill = patternFill('');
        break;
      default:
        fill = solidFill({ space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 });
    }
    addSelectedFill(fill);
    announce('Fill added');
  }, [newFillType, addSelectedFill, announce]);

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

  return (
    <DisclosureSection title="Fill">
      {fills.length === 0 && <div className="insp-empty-message">No fill</div>}
      <div ref={bindingTriggerRef} className="insp-field" style={{ position: 'relative' }}>
        {fills.map((fill, i) => (
          <FillRow
            key={i}
            index={i}
            fill={fill}
            nodes={nodes}
            expanded={expandedRows.has(i)}
            onToggle={() => toggleRow(i)}
            onChange={(f) => updateFill(i, f)}
            onRemove={() => removeFill(i)}
            onReorder={(dir) => reorderFill(i, i + dir)}
            pickerOpen={openPickerFor === i}
            onPickerToggle={() => setOpenPickerFor((p) => (p === i ? null : i))}
            canMoveUp={i > 0}
            canMoveDown={i < fills.length - 1}
          />
        ))}
      </div>
      {countMixed && fills.length > 0 && (
        <div className="insp-empty-message">Some selected nodes have additional fills</div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-1)', paddingTop: 'var(--space-1)' }}>
        <select
          aria-label="New fill type"
          value={newFillType}
          className="insp-select"
          onChange={(e) => setNewFillType(e.target.value as FillType)}
        >
          {FILL_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button type="button" className="insp-add-btn" onClick={addFill}>
          <Icon name="Plus" label={undefined} size="0.85em" />
          <span>Add</span>
        </button>
      </div>
      {editor.bindingField === 'fill' && (
        <BindingMenu
          variableStore={editor.state.variableStore as import('@strata/scene').VariableStore}
          targetType="color"
          onBind={(variableId, expression) => {
            editor.setSelectedBinding('fill', { variableId, expression });
            editor.setBindingField(null);
          }}
          onClose={() => editor.setBindingField(null)}
          triggerRef={bindingTriggerRef}
        />
      )}
    </DisclosureSection>
  );
}

interface FillRowProps {
  index: number;
  fill: Fill;
  nodes: SceneNode[];
  expanded: boolean;
  onToggle: () => void;
  onChange: (fill: Fill) => void;
  onRemove: () => void;
  onReorder: (dir: number) => void;
  pickerOpen: boolean;
  onPickerToggle: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

function FillRow({
  index,
  fill,
  nodes,
  expanded,
  onToggle,
  onChange,
  onRemove,
  onReorder,
  pickerOpen,
  onPickerToggle,
  canMoveUp,
  canMoveDown,
}: FillRowProps) {
  const label = index === 0 ? 'Fill' : `Fill ${index + 1}`;
  const triggerRef = useRef<HTMLButtonElement>(null);

  const visibleRaw = commonValue(nodes, (n) => resolveNodeFills(n)[index]?.visible ?? true);
  const typeRaw = commonValue(nodes, (n) => resolveNodeFills(n)[index]?.type ?? 'solid');
  const opacityRaw = commonValue(nodes, (n) => resolveNodeFills(n)[index]?.opacity ?? 1);
  const blendRaw = commonValue(nodes, (n) => resolveNodeFills(n)[index]?.blendMode ?? 'normal');

  const visible = isMixed(visibleRaw) ? true : visibleRaw;
  const swatchBg = fillSwatchBg(fill);

  const patch = useCallback(
    (partial: Partial<Fill>) => onChange({ ...fill, ...partial }),
    [fill, onChange],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        padding: 'var(--space-1) 0',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <div className="insp-field">
        <button
          type="button"
          className="insp-inline-btn"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
          onClick={() => patch({ visible: !visible })}
        >
          <Icon name={visible ? 'Eye' : 'EyeOff'} label={undefined} size="0.85em" />
        </button>
        <button
          ref={triggerRef}
          type="button"
          aria-label={`${label} colour`}
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          onClick={onPickerToggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onPickerToggle();
            }
          }}
          className="insp-swatch"
          style={{
            background: swatchBg,
            border: '2px solid var(--color-border-strong)',
          }}
        />
        <select
          aria-label={`${label} type`}
          value={isMixed(typeRaw) ? '' : typeRaw}
          className="insp-select"
          onChange={(e) => {
            const newType = e.target.value as FillType;
            if (newType === 'solid') {
              patch({
                type: 'solid',
                color: fill.color ?? { space: 'rgb' as const, r: 255, g: 255, b: 255, a: 255 },
              });
            } else if (newType === 'gradient') {
              patch({
                type: 'gradient',
                gradient: fill.gradient ?? {
                  type: 'linear',
                  stops: [
                    {
                      position: 0,
                      color: { space: 'rgb' as const, r: 57, g: 208, b: 198, a: 255 },
                    },
                    { position: 1, color: { space: 'rgb' as const, r: 37, g: 99, b: 235, a: 255 } },
                  ],
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
          }}
        >
          {isMixed(typeRaw) && <option value="">Mixed</option>}
          {FILL_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
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

      {pickerOpen && fill.type === 'solid' && fill.color && (
        <div
          className="insp-picker-popover"
          style={{
            position: 'relative',
            top: 'auto',
            left: 'auto',
          }}
        >
          <ColorPicker value={fill.color!} onChange={(c) => patch({ color: c })} />
        </div>
      )}

      {expanded && fill.type === 'gradient' && fill.gradient && (
        <GradientEditor
          gradient={fill.gradient}
          onChange={(g: GradientFill) => patch({ gradient: g })}
        />
      )}

      {expanded && fill.type === 'image' && fill.image && (
        <ImageFillControls
          image={fill.image}
          onChange={(img: ImageFillData) => patch({ image: img })}
        />
      )}

      {expanded && fill.type === 'pattern' && fill.pattern && (
        <PatternFillControls
          pattern={fill.pattern}
          onChange={(p: PatternFillData) => patch({ pattern: p })}
        />
      )}

      <button type="button" onClick={onToggle} className="insp-advanced-btn">
        <Icon
          name="ChevronRight"
          label={undefined}
          size="0.75em"
          style={{
            transition: 'transform var(--duration-quick) var(--ease-standard)',
            transform: expanded ? 'rotate(90deg)' : 'none',
          }}
        />
        <span>Advanced</span>
      </button>

      {expanded && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            paddingLeft: 'var(--space-4)',
          }}
        >
          <NumberField
            label="Opacity"
            value={isMixed(opacityRaw) ? 1 : opacityRaw}
            mixed={isMixed(opacityRaw)}
            step={0.01}
            min={0}
            max={1}
            onChange={(v) => patch({ opacity: v })}
          />
          <div className="insp-field">
            <span className="insp-field__label">Blend</span>
            <div className="insp-field__control">
              <select
                aria-label={`${label} blend mode`}
                value={isMixed(blendRaw) ? '' : blendRaw}
                className="insp-select"
                onChange={(e) => patch({ blendMode: e.target.value as BlendMode })}
              >
                {isMixed(blendRaw) && <option value="">Mixed</option>}
                {BLEND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PatternFillControls({
  pattern,
  onChange,
}: {
  pattern: PatternFillData;
  onChange: (p: PatternFillData) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <div className="insp-field">
        <span className="insp-field__label">Tile</span>
        <div className="insp-field__control">
          <input
            type="text"
            value={pattern.tileSrc}
            aria-label="Pattern tile source"
            placeholder="Tile URL or asset id"
            onChange={(e) => onChange({ ...pattern, tileSrc: e.target.value })}
            className="insp-num__input"
          />
        </div>
      </div>
      <NumberField
        label="Spacing"
        unit="px"
        value={pattern.spacing}
        min={0}
        onChange={(v) => onChange({ ...pattern, spacing: v })}
      />
      <NumberField
        label="Rotation"
        unit="deg"
        value={pattern.rotation}
        onChange={(v) => onChange({ ...pattern, rotation: v })}
      />
    </div>
  );
}
