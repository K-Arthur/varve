/**
 * TypographySection — font and text-style controls for TextNode selections.
 *
 * Full property set: family, weight, style, size, line-height, letter-spacing,
 * paragraph spacing, text align (h/v), text case, decoration, list style,
 * truncation/overflow, resizing mode, and OpenType features (stub).
 *
 * Multi-select: every control uses commonValue and shows "Mixed" when values
 * differ. Editing applies to all selected text nodes via batch update in one
 * undo step. Batch typography editing is a flagship feature.
 *
 * Token binding: all numeric fields support shift-click / `=` to open the
 * binding menu. Math expressions allowed on numeric fields.
 *
 * Research basis: Figma / Sketch typography panel, APG Disclosure, Radiogroup.
 */
import { getFontRegistry } from '@varve/engine';
import type { SceneNode, TextNode } from '@varve/scene';
import { resolveNodeFills } from '@varve/scene';
import { Select } from '@varve/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { docVariableStore } from '../../../docVariableStore';
import { FontSelector } from '../../FontBrowser/FontSelector';
import { GlyphTypographySection } from '../../Typography/GlyphTypographySection';
import { BindingMenu } from '../controls/BindingMenu';
import { ContrastIndicator } from '../controls/ContrastIndicator';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { RichTextSpanEditor } from '../controls/RichTextSpanEditor';
import type { SegmentedOption } from '../controls/SegmentedControl';
import { SegmentedControl } from '../controls/SegmentedControl';
import { commonValue, isMixed, type MaybeMixed } from '../selection/selectionState';

export interface TypographySectionProps {
  nodes: SceneNode[];
}

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const DIRECTION_OPTIONS: readonly SegmentedOption<'auto' | 'ltr' | 'rtl'>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'ltr', label: 'LTR' },
  { value: 'rtl', label: 'RTL' },
] as const;

const TEXT_ALIGN_OPTIONS: readonly SegmentedOption<'left' | 'center' | 'right' | 'justify'>[] = [
  { value: 'left', label: 'L' },
  { value: 'center', label: 'C' },
  { value: 'right', label: 'R' },
  { value: 'justify', label: 'J' },
] as const;

const TEXT_ALIGN_V_OPTIONS: readonly SegmentedOption<'top' | 'middle' | 'bottom'>[] = [
  { value: 'top', label: 'T' },
  { value: 'middle', label: 'M' },
  { value: 'bottom', label: 'B' },
] as const;

const TEXT_CASE_OPTIONS: readonly SegmentedOption<
  'none' | 'uppercase' | 'lowercase' | 'capitalize'
>[] = [
  { value: 'none', label: 'Aa' },
  { value: 'uppercase', label: 'AA' },
  { value: 'lowercase', label: 'aa' },
  { value: 'capitalize', label: 'A' },
] as const;

const TEXT_DECORATION_OPTIONS: readonly SegmentedOption<'none' | 'underline' | 'line-through'>[] = [
  { value: 'none', label: 'None' },
  { value: 'underline', label: 'U' },
  { value: 'line-through', label: 'S' },
] as const;

const FONT_STYLE_OPTIONS: readonly SegmentedOption<'normal' | 'italic'>[] = [
  { value: 'normal', label: 'Reg' },
  { value: 'italic', label: 'Ital' },
] as const;

const LIST_STYLE_OPTIONS: { value: TextNode['listStyle']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'disc', label: 'Bullet' },
  { value: 'decimal', label: 'Number' },
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
];

const OVERFLOW_OPTIONS: { value: TextNode['textOverflow']; label: string }[] = [
  { value: 'visible', label: 'Visible' },
  { value: 'clip', label: 'Clip' },
  { value: 'ellipsis', label: 'Ellipsis' },
];

const RESIZING_OPTIONS: { value: TextNode['textResizing']; label: string }[] = [
  { value: 'autoWidth', label: 'Auto W' },
  { value: 'autoHeight', label: 'Auto H' },
  { value: 'fixed', label: 'Fixed' },
];

const OPENTYPE_FEATURE_LABELS: Record<string, string> = {
  liga: 'Standard Ligatures',
  dlig: 'Discretionary Ligatures',
  sups: 'Superscript',
  subs: 'Subscript',
  numr: 'Numerators',
  dnom: 'Denominators',
  frac: 'Fractions',
  ordn: 'Ordinals',
  tnum: 'Tabular Numbers',
  pnum: 'Proportional Numbers',
  lnum: 'Lining Figures',
  onum: 'Old-Style Figures',
  zero: 'Slashed Zero',
  ss01: 'Stylistic Set 1',
  ss02: 'Stylistic Set 2',
  ss03: 'Stylistic Set 3',
  ss04: 'Stylistic Set 4',
  ss05: 'Stylistic Set 5',
  ss06: 'Stylistic Set 6',
  ss07: 'Stylistic Set 7',
  ss08: 'Stylistic Set 8',
  ss09: 'Stylistic Set 9',
  ss10: 'Stylistic Set 10',
  kern: 'Kerning',
  calt: 'Contextual Alternates',
  case: 'Case-Sensitive Forms',
  cpsp: 'Capital Spacing',
  aalt: 'Access All Alternates',
  salt: 'Stylistic Alternates',
  locl: 'Localized Forms',
  rlig: 'Required Ligatures',
  mark: 'Mark Positioning',
  mkmk: 'Mark-to-Mark Positioning',
  ccmp: 'Glyph Composition',
  init: 'Initial Forms',
  medi: 'Medial Forms',
  fina: 'Final Forms',
  isol: 'Isolated Forms',
};

const COMMON_FEATURES = [
  'liga',
  'dlig',
  'kern',
  'calt',
  'tnum',
  'pnum',
  'lnum',
  'onum',
  'frac',
  'zero',
  'case',
  'ss01',
  'ss02',
  'ss03',
];

function getTextValue<T>(n: SceneNode, accessor: (t: TextNode) => T): T {
  return accessor(n as TextNode);
}

export function TypographySection({ nodes }: TypographySectionProps) {
  const editor = useEditor();
  const {
    updateNode,
    beginTransaction,
    commitTransaction,
    setBindingField,
    bindingField,
    setSelectedBinding,
  } = editor;
  const bindingTriggerRef = useRef<HTMLDivElement>(null);
  const [richTextEnabled, setRichTextEnabled] = useState(false);

  const textNodes = useMemo(() => nodes.filter((n): n is TextNode => n.kind === 'text'), [nodes]);

  const batchUpdate = useCallback(
    (updater: (node: TextNode) => TextNode) => {
      if (textNodes.length === 0) return;
      beginTransaction();
      for (const node of textNodes) {
        updateNode(node.id, (n) => {
          if (n.kind !== 'text') return n;
          return updater(n);
        });
      }
      commitTransaction();
    },
    [textNodes, updateNode, beginTransaction, commitTransaction],
  );

  const textContent = useMemo(() => {
    const textVals = textNodes.map((n) => n.text);
    return textVals.every((v) => v === textVals[0]) ? textVals[0] : '(Mixed)';
  }, [textNodes]);

  const handleTextChange = useCallback(
    (text: string) => {
      beginTransaction();
      for (const n of textNodes) {
        updateNode(n.id, (node) => {
          if (node.kind !== 'text') return node;
          return { ...node, text };
        });
      }
      commitTransaction();
    },
    [textNodes, updateNode, beginTransaction, commitTransaction],
  );

  const textFillColor = useMemo(() => {
    if (textNodes.length !== 1) return null;
    const n = textNodes[0];
    if (!n) return null;
    const fills = resolveNodeFills(
      n as unknown as {
        fill: import('@varve/scene').ManagedColor;
        fills?: import('@varve/scene').Fill[];
      },
    );
    const solid = fills.find((f) => f.visible && f.type === 'solid');
    if (solid?.color && solid.color.space === 'rgb') {
      return { r: solid.color.r, g: solid.color.g, b: solid.color.b };
    }
    return null;
  }, [textNodes]);

  if (textNodes.length === 0) return null;

  const familyRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.fontFamily ?? ''));
  const weightRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.fontWeight ?? 400));
  const styleRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.fontStyle ?? 'normal'));
  const sizeRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.fontSize));
  const lineHeightRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.lineHeight ?? 1.2));
  const letterSpacingRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.letterSpacing ?? 0),
  );
  const trackingRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.tracking ?? 0));
  const paraSpacingRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.paragraphSpacing ?? 0),
  );
  const alignRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.textAlign ?? 'left'));
  const directionRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.direction ?? 'auto'));
  const alignVRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.textAlignVertical ?? 'top'),
  );
  const caseRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.textCase ?? 'none'));
  const decorationRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.textDecoration ?? 'none'),
  );
  const listRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.listStyle ?? 'none'));
  const overflowRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.textOverflow ?? 'visible'),
  );
  const resizingRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.textResizing ?? 'fixed'),
  );

  return (
    <DisclosureSection title="Typography" sectionId="typography">
      <div ref={bindingTriggerRef} className="insp-field-group">
        {textContent !== null && (
          <>
            <FieldRow label="Content">
              {richTextEnabled && textNodes.length === 1 ? (
                <RichTextSpanEditor
                  richText={
                    textNodes[0]!.richText ?? {
                      paragraphs: [{ runs: [{ text: textNodes[0]!.text }] }],
                    }
                  }
                  onChange={(rich) =>
                    updateNode(textNodes[0]!.id, (n) =>
                      n.kind === 'text' ? { ...n, richText: rich } : n,
                    )
                  }
                />
              ) : (
                <textarea
                  className="typography__text-input"
                  value={textContent === '(Mixed)' ? '' : textContent}
                  onChange={(e) => handleTextChange(e.target.value)}
                  rows={3}
                  aria-label="Text content"
                />
              )}
            </FieldRow>
            <FieldRow label="Rich Text">
              <button
                type="button"
                role="switch"
                aria-checked={richTextEnabled}
                aria-label="Enable rich text editing"
                className="insp-segmented__btn"
                style={{ flex: '0 0 auto' }}
                onClick={() => setRichTextEnabled((v) => !v)}
              >
                {richTextEnabled ? 'On' : 'Off'}
              </button>
            </FieldRow>
          </>
        )}
        <FieldRow label="Font">
          <FontSelector
            value={isMixed(familyRaw) ? '' : familyRaw}
            onChange={(v) => batchUpdate((n) => ({ ...n, fontFamily: v || undefined }))}
          />
        </FieldRow>
        <FieldRow label="Weight">
          <Select
            label="Font weight"
            value={isMixed(weightRaw) ? '400' : String(weightRaw)}
            placeholder={isMixed(weightRaw) ? 'Mixed' : undefined}
            options={FONT_WEIGHTS.map((w) => ({ value: String(w), label: String(w) }))}
            onChange={(v) => batchUpdate((n) => ({ ...n, fontWeight: Number(v) }))}
          />
        </FieldRow>
        <FieldRow label="Style">
          <SegmentedControl
            label="Font style"
            value={isMixed(styleRaw) ? 'normal' : styleRaw}
            options={FONT_STYLE_OPTIONS}
            onChange={(v) => batchUpdate((n) => ({ ...n, fontStyle: v }))}
          />
          {textFillColor && (
            <ContrastIndicator
              fgColor={textFillColor}
              bgColor={null}
              fontSize={isMixed(sizeRaw) ? 16 : sizeRaw}
              fontWeight={isMixed(weightRaw) ? 400 : weightRaw}
            />
          )}
        </FieldRow>
        <NumberField
          label="Size"
          unit="px"
          value={isMixed(sizeRaw) ? 16 : sizeRaw}
          mixed={isMixed(sizeRaw)}
          step={1}
          min={0}
          fieldName="fontSize"
          onShiftClick={() => setBindingField('fontSize')}
          onChange={(v) => batchUpdate((n) => ({ ...n, fontSize: v }))}
        />
        <NumberField
          label="Line height"
          unit="%"
          value={isMixed(lineHeightRaw) ? 1.2 : lineHeightRaw}
          mixed={isMixed(lineHeightRaw)}
          step={0.1}
          min={0}
          fieldName="lineHeight"
          onShiftClick={() => setBindingField('lineHeight')}
          onChange={(v) => batchUpdate((n) => ({ ...n, lineHeight: v }))}
        />
        <NumberField
          label="Letter spacing"
          unit="px"
          value={isMixed(letterSpacingRaw) ? 0 : letterSpacingRaw}
          mixed={isMixed(letterSpacingRaw)}
          step={0.1}
          fieldName="letterSpacing"
          onShiftClick={() => setBindingField('letterSpacing')}
          onChange={(v) => batchUpdate((n) => ({ ...n, letterSpacing: v }))}
        />
        <NumberField
          label="Tracking"
          unit="‰"
          value={isMixed(trackingRaw) ? 0 : trackingRaw}
          mixed={isMixed(trackingRaw)}
          step={10}
          fieldName="tracking"
          onShiftClick={() => setBindingField('tracking')}
          onChange={(v) => batchUpdate((n) => ({ ...n, tracking: v }))}
        />
        <NumberField
          label="Para spacing"
          unit="px"
          value={isMixed(paraSpacingRaw) ? 0 : paraSpacingRaw}
          mixed={isMixed(paraSpacingRaw)}
          step={1}
          min={0}
          fieldName="paragraphSpacing"
          onShiftClick={() => setBindingField('paragraphSpacing')}
          onChange={(v) => batchUpdate((n) => ({ ...n, paragraphSpacing: v }))}
        />
        <FieldRow label="Align">
          <SegmentedControl
            label="Text align"
            value={isMixed(alignRaw) ? 'left' : alignRaw}
            options={TEXT_ALIGN_OPTIONS}
            onChange={(v) => batchUpdate((n) => ({ ...n, textAlign: v }))}
          />
        </FieldRow>
        <FieldRow label="Direction">
          <SegmentedControl
            label="Text direction"
            value={isMixed(directionRaw) ? 'auto' : directionRaw}
            options={DIRECTION_OPTIONS}
            onChange={(v) => batchUpdate((n) => ({ ...n, direction: v }))}
          />
        </FieldRow>
        <FieldRow label="V Align">
          <SegmentedControl
            label="Text vertical align"
            value={isMixed(alignVRaw) ? 'top' : alignVRaw}
            options={TEXT_ALIGN_V_OPTIONS}
            onChange={(v) => batchUpdate((n) => ({ ...n, textAlignVertical: v }))}
          />
        </FieldRow>
        <FieldRow label="Case">
          <SegmentedControl
            label="Text case"
            value={isMixed(caseRaw) ? 'none' : caseRaw}
            options={TEXT_CASE_OPTIONS}
            onChange={(v) => batchUpdate((n) => ({ ...n, textCase: v }))}
          />
        </FieldRow>
        <FieldRow label="Decoration">
          <SegmentedControl
            label="Text decoration"
            value={isMixed(decorationRaw) ? 'none' : decorationRaw}
            options={TEXT_DECORATION_OPTIONS}
            onChange={(v) => batchUpdate((n) => ({ ...n, textDecoration: v }))}
          />
        </FieldRow>
        <FieldRow label="List">
          <Select
            label="List style"
            value={isMixed(listRaw) ? 'none' : listRaw}
            options={LIST_STYLE_OPTIONS.map((o) => ({ value: o.value as string, label: o.label }))}
            onChange={(v) => batchUpdate((n) => ({ ...n, listStyle: v as TextNode['listStyle'] }))}
          />
        </FieldRow>
        <FieldRow label="Overflow">
          <Select
            label="Text overflow"
            value={isMixed(overflowRaw) ? 'visible' : overflowRaw}
            options={OVERFLOW_OPTIONS.map((o) => ({ value: o.value as string, label: o.label }))}
            onChange={(v) =>
              batchUpdate((n) => ({
                ...n,
                textOverflow: v as TextNode['textOverflow'],
              }))
            }
          />
        </FieldRow>
        <FieldRow label="Resize">
          <Select
            label="Text resizing mode"
            value={isMixed(resizingRaw) ? 'fixed' : resizingRaw}
            options={RESIZING_OPTIONS.map((o) => ({ value: o.value as string, label: o.label }))}
            onChange={(v) =>
              batchUpdate((n) => ({
                ...n,
                textResizing: v as TextNode['textResizing'],
              }))
            }
          />
        </FieldRow>
        {/* OpenType features */}
        <OpenTypeFeaturesSection
          textNodes={textNodes}
          familyRaw={familyRaw}
          batchUpdate={batchUpdate}
        />
        {/* Variable font axes */}
        <VariableAxesSection
          textNodes={textNodes}
          familyRaw={familyRaw}
          batchUpdate={batchUpdate}
        />
        {/* Binding menu for typography numeric fields */}
        {bindingField &&
          ['fontSize', 'lineHeight', 'letterSpacing', 'tracking', 'paragraphSpacing'].includes(
            bindingField,
          ) && (
            <BindingMenu
              variableStore={docVariableStore(editor.state.document)}
              targetType="number"
              onBind={(variableId, expression) => {
                if (bindingField) setSelectedBinding(bindingField, { variableId, expression });
                setBindingField(null);
              }}
              onClose={() => setBindingField(null)}
              triggerRef={bindingTriggerRef}
            />
          )}
      </div>
      {textNodes.length === 1 && (
        <div className="insp-field-group">
          <GlyphTypographySection node={textNodes[0]!} />
        </div>
      )}
    </DisclosureSection>
  );
}

// ── OpenType Features Sub-section ─────────────────────────────────────────

interface OpenTypeFeaturesSectionProps {
  textNodes: TextNode[];
  familyRaw: MaybeMixed<string>;
  batchUpdate: (updater: (node: TextNode) => TextNode) => void;
}

function OpenTypeFeaturesSection({
  textNodes,
  familyRaw,
  batchUpdate,
}: OpenTypeFeaturesSectionProps) {
  const registry = getFontRegistry();
  const family = isMixed(familyRaw) ? '' : familyRaw;
  const supportedFeatures = family ? registry.getSupportedFeatures(family) : [];
  const featuresToShow = supportedFeatures.length > 0 ? supportedFeatures : COMMON_FEATURES;

  const currentFeatures = commonValue(textNodes, (n) => (n as TextNode).openTypeFeatures ?? {});
  const featuresMap = isMixed(currentFeatures) ? {} : currentFeatures;

  const toggleFeature = useCallback(
    (tag: string, enabled: boolean) => {
      batchUpdate((n) => ({
        ...n,
        openTypeFeatures: { ...(n.openTypeFeatures ?? {}), [tag]: enabled },
      }));
    },
    [batchUpdate],
  );

  return (
    <DisclosureSection
      title="OpenType Features"
      sectionId="typography"
      subsectionId="openTypeFeatures"
      defaultExpanded={false}
    >
      <div className="insp-opentype-list">
        {featuresToShow.map((tag) => (
          <label key={tag} className="insp-opentype-row">
            <input
              type="checkbox"
              checked={featuresMap[tag] === true}
              onChange={(e) => toggleFeature(tag, e.target.checked)}
              aria-label={OPENTYPE_FEATURE_LABELS[tag] ?? tag}
            />
            <span className="insp-opentype-label">{OPENTYPE_FEATURE_LABELS[tag] ?? tag}</span>
            <code className="insp-opentype-tag">{tag}</code>
          </label>
        ))}
      </div>
    </DisclosureSection>
  );
}

// ── Variable Font Axes Sub-section ────────────────────────────────────────

interface VariableAxesSectionProps {
  textNodes: TextNode[];
  familyRaw: MaybeMixed<string>;
  batchUpdate: (updater: (node: TextNode) => TextNode) => void;
}

function VariableAxesSection({ textNodes, familyRaw, batchUpdate }: VariableAxesSectionProps) {
  const registry = getFontRegistry();
  const family = isMixed(familyRaw) ? '' : familyRaw;

  const setAxis = useCallback(
    (tag: string, value: number) => {
      batchUpdate((n) => ({
        ...n,
        variableAxes: { ...(n.variableAxes ?? {}), [tag]: value },
      }));
    },
    [batchUpdate],
  );

  const resetAxis = useCallback(
    (tag: string) => {
      batchUpdate((n) => {
        const next = { ...(n.variableAxes ?? {}) };
        delete next[tag];
        return { ...n, variableAxes: next };
      });
    },
    [batchUpdate],
  );

  const currentAxes = commonValue(textNodes, (n) => (n as TextNode).variableAxes ?? {});
  const axesMap = isMixed(currentAxes) ? {} : currentAxes;

  // Every hook above runs unconditionally: this early return used to sit
  // ahead of the callbacks, so the hook count changed the moment a selection
  // moved between a variable and a static family.
  if (!family || !registry.isVariable(family)) return null;

  // Only the axes this family declares. Falling back to the full generic tag
  // list offered sliders for axes the font does not vary — dragging them
  // wrote variation settings the shaper simply ignored.
  const definitions = registry.getAxisDefinitions(family);
  const activeAxisTags = definitions
    ? definitions.map((a) => a.tag)
    : Object.keys(registry.getVariableAxes(family) ?? {});
  if (activeAxisTags.length === 0) return null;

  return (
    <DisclosureSection
      title="Variable Font Axes"
      sectionId="typography"
      subsectionId="variableFontAxes"
      defaultExpanded={false}
    >
      {activeAxisTags.map((tag) => {
        const info = registry.getAxisInfo(tag, family);
        if (!info) return null;
        const value = axesMap[tag] ?? info.default;
        const isDefault = value === info.default;
        // Integral axes (wght, ital) should not land on fractional values;
        // a fixed 1/100th-of-range step put wght on 92.8 for a 100-900 face.
        const span = info.max - info.min;
        const step = span >= 100 ? 1 : span / 100;
        return (
          <div key={tag} className="insp-field">
            <label className="insp-field__label" htmlFor={`vf-${tag}`}>
              {info.name}
            </label>
            <div className="insp-field__control">
              <div className="insp-slider">
                <input
                  type="range"
                  id={`vf-${tag}`}
                  className="insp-slider__input"
                  min={info.min}
                  max={info.max}
                  step={step}
                  value={value}
                  onChange={(e) => setAxis(tag, Number(e.target.value))}
                  aria-label={`${info.name} (${tag})`}
                  aria-valuemin={info.min}
                  aria-valuemax={info.max}
                  aria-valuenow={value}
                />
                <span className="insp-slider__value" data-axis={tag}>
                  {Number.isInteger(value) ? value : value.toFixed(1)}
                </span>
                <button
                  type="button"
                  className="insp-slider__reset"
                  onClick={() => resetAxis(tag)}
                  disabled={isDefault}
                  title={`Reset ${info.name} to ${info.default}`}
                  aria-label={`Reset ${info.name} to default`}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </DisclosureSection>
  );
}
