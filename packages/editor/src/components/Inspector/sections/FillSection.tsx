/**
 * FillSection — stacked fill controls for the Inspector.
 *
 * Supports solid, gradient (linear/radial/angular/diamond), image, and pattern
 * fills. Fills are stacked (paint order bottom→top), reorderable via drag,
 * with per-fill opacity, blend mode, visibility toggle, and delete.
 *
 * Multi-select: matches fills by index across selected nodes, shows "Mixed" for
 * differing properties. Edits batch across all selected in one undo step via
 * the transaction API.
 *
 * Research basis: Figma/Sketch fill panel; APG Disclosure, Listbox, Slider.
 */
import type { Color } from '@strata/engine';
import type {
  BlendMode,
  Fill,
  FillType,
  GradientFill,
  ImageFillData,
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
];

const FILL_TYPE_OPTIONS: { value: FillType; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image', label: 'Image' },
  { value: 'pattern', label: 'Pattern' },
];

const SELECT_STYLE: React.CSSProperties = {
  flex: 1,
  height: 'var(--space-5)',
  fontSize: 'var(--font-size-xs)',
  background: 'var(--color-surface-sunken)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-2)',
};

const INLINE_BTN: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  background: 'transparent',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

const ADD_BTN: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-1)',
  width: '100%',
  height: 'var(--space-5)',
  background: 'transparent',
  border: '1px dashed var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-muted)',
  font: 'inherit',
  fontSize: 'var(--font-size-xs)',
  cursor: 'pointer',
};

function fillSwatchBg(fill: Fill): string {
  if (fill.type === 'solid' && fill.color) {
    return `rgba(${fill.color[0]},${fill.color[1]},${fill.color[2]},${(fill.color[3] / 255).toFixed(2)})`;
  }
  if (fill.type === 'gradient' && fill.gradient) {
    const stops = fill.gradient.stops
      .map(
        (s) =>
          `rgba(${s.color[0]},${s.color[1]},${s.color[2]},${(s.color[3] / 255).toFixed(2)}) ${(s.position * 100).toFixed(0)}%`,
      )
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
          { position: 0, color: [57, 208, 198, 255] as Color },
          { position: 1, color: [37, 99, 235, 255] as Color },
        ]);
        break;
      case 'image':
        fill = imageFill('');
        break;
      case 'pattern':
        fill = patternFill('');
        break;
      default:
        fill = solidFill([255, 255, 255, 255] as Color);
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
      {fills.length === 0 && (
        <div
          style={{
            padding: 'var(--space-2) 0',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          No fill
        </div>
      )}
      <div ref={bindingTriggerRef} style={{ position: 'relative' }}>
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
        <div
          style={{
            padding: 'var(--space-1) 0',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          Some selected nodes have additional fills
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-1)', paddingTop: 'var(--space-1)' }}>
        <select
          aria-label="New fill type"
          value={newFillType}
          style={{ ...SELECT_STYLE, flex: 1 }}
          onChange={(e) => setNewFillType(e.target.value as FillType)}
        >
          {FILL_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button type="button" style={ADD_BTN} onClick={addFill}>
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
          style={INLINE_BTN}
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
          style={{
            width: 24,
            height: 24,
            borderRadius: 'var(--radius-sm)',
            background: swatchBg,
            border: '2px solid var(--color-border-strong)',
            cursor: 'pointer',
            flexShrink: 0,
            padding: 0,
          }}
        />
        <select
          aria-label={`${label} type`}
          value={isMixed(typeRaw) ? '' : typeRaw}
          style={{ ...SELECT_STYLE, flex: 1 }}
          onChange={(e) => {
            const newType = e.target.value as FillType;
            if (newType === 'solid') {
              patch({ type: 'solid', color: fill.color ?? ([255, 255, 255, 255] as Color) });
            } else if (newType === 'gradient') {
              patch({
                type: 'gradient',
                gradient: fill.gradient ?? {
                  type: 'linear',
                  stops: [
                    { position: 0, color: [57, 208, 198, 255] as Color },
                    { position: 1, color: [37, 99, 235, 255] as Color },
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
          style={{
            ...INLINE_BTN,
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
          style={{
            ...INLINE_BTN,
            opacity: canMoveDown ? 1 : 0.3,
            cursor: canMoveDown ? 'pointer' : 'not-allowed',
          }}
        >
          <Icon name="ChevronDown" label={undefined} size="0.85em" />
        </button>
        <button type="button" style={INLINE_BTN} aria-label={`Remove ${label}`} onClick={onRemove}>
          <Icon name="X" label={undefined} size="0.85em" />
        </button>
      </div>

      {pickerOpen && fill.type === 'solid' && fill.color && (
        <div
          style={{
            position: 'relative',
            zIndex: 'var(--z-overlay)',
            background: 'var(--color-surface-overlay)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            padding: 'var(--space-2)',
          }}
        >
          <ColorPicker value={fill.color} onChange={(c) => patch({ color: c })} />
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

      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          background: 'transparent',
          border: 'none',
          color: 'var(--color-text-muted)',
          font: 'inherit',
          fontSize: 'var(--font-size-xs)',
          cursor: 'pointer',
          padding: 'var(--space-1) 0',
        }}
      >
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
                style={SELECT_STYLE}
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
            style={{ flex: 1 }}
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
