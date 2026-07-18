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
import { getFontRegistry } from '@strata/engine';
import type { SceneNode, TextNode } from '@strata/scene';
import { resolveNodeFills } from '@strata/scene';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { docVariableStore } from '../../../docVariableStore';
import { BindingMenu } from '../controls/BindingMenu';
import { ContrastIndicator } from '../controls/ContrastIndicator';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import type { SegmentedOption } from '../controls/SegmentedControl';
import { SegmentedControl } from '../controls/SegmentedControl';
import { commonValue, isMixed, type MaybeMixed } from '../selection/selectionState';

export interface TypographySectionProps {
  nodes: SceneNode[];
}

const SYSTEM_FONTS = [
  'Inter',
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
  'sans-serif',
  'serif',
  'monospace',
];

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

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
  const [registryFonts, setRegistryFonts] = useState<string[]>([]);

  useEffect(() => {
    const registry = getFontRegistry();
    setRegistryFonts(registry.families());
  }, []);

  const fonts = registryFonts.length > 0 ? registryFonts : SYSTEM_FONTS;
  const {
    updateNode,
    beginTransaction,
    commitTransaction,
    setBindingField,
    bindingField,
    setSelectedBinding,
  } = editor;
  const bindingTriggerRef = useRef<HTMLDivElement>(null);

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

  if (textNodes.length === 0) return null;

  const textFillColor = useMemo(() => {
    if (textNodes.length !== 1) return null;
    const n = textNodes[0];
    if (!n) return null;
    const fills = resolveNodeFills(
      n as unknown as {
        fill: import('@strata/scene').ManagedColor;
        fills?: import('@strata/scene').Fill[];
      },
    );
    const solid = fills.find((f) => f.visible && f.type === 'solid');
    if (solid?.color && solid.color.space === 'rgb') {
      return { r: solid.color.r, g: solid.color.g, b: solid.color.b };
    }
    return null;
  }, [textNodes]);

  const familyRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.fontFamily ?? ''));
  const weightRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.fontWeight ?? 400));
  const styleRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.fontStyle ?? 'normal'));
  const sizeRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.fontSize));
  const lineHeightRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.lineHeight ?? 1.2));
  const letterSpacingRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.letterSpacing ?? 0),
  );
  const paraSpacingRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.paragraphSpacing ?? 0),
  );
  const alignRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.textAlign ?? 'left'));
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
    <DisclosureSection title="Typography">
      <div ref={bindingTriggerRef} className="insp-field-group">
        {textContent !== null && (
          <FieldRow label="Content">
            <textarea
              className="typography__text-input"
              value={textContent === '(Mixed)' ? '' : textContent}
              onChange={(e) => handleTextChange(e.target.value)}
              rows={3}
              aria-label="Text content"
            />
          </FieldRow>
        )}
        <FieldRow label="Font" htmlFor="typography-font">
          <select
            id="typography-font"
            aria-label="Font family"
            value={isMixed(familyRaw) ? '' : familyRaw}
            className="insp-select"
            onChange={(e) => {
              const v = e.target.value;
              batchUpdate((n) => ({ ...n, fontFamily: v || undefined }));
            }}
          >
            {isMixed(familyRaw) && <option value="">Mixed</option>}
            {fonts.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Weight" htmlFor="typography-weight">
          <select
            id="typography-weight"
            aria-label="Font weight"
            value={isMixed(weightRaw) ? 400 : weightRaw}
            className="insp-select"
            onChange={(e) => batchUpdate((n) => ({ ...n, fontWeight: Number(e.target.value) }))}
          >
            {isMixed(weightRaw) && <option value={400}>Mixed</option>}
            {FONT_WEIGHTS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
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
        <FieldRow label="List" htmlFor="typography-list">
          <select
            id="typography-list"
            aria-label="List style"
            value={isMixed(listRaw) ? 'none' : listRaw}
            className="insp-select"
            onChange={(e) =>
              batchUpdate((n) => ({ ...n, listStyle: e.target.value as TextNode['listStyle'] }))
            }
          >
            {LIST_STYLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Overflow" htmlFor="typography-overflow">
          <select
            id="typography-overflow"
            aria-label="Text overflow"
            value={isMixed(overflowRaw) ? 'visible' : overflowRaw}
            className="insp-select"
            onChange={(e) =>
              batchUpdate((n) => ({
                ...n,
                textOverflow: e.target.value as TextNode['textOverflow'],
              }))
            }
          >
            {OVERFLOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Resize" htmlFor="typography-resizing">
          <select
            id="typography-resizing"
            aria-label="Text resizing mode"
            value={isMixed(resizingRaw) ? 'fixed' : resizingRaw}
            className="insp-select"
            onChange={(e) =>
              batchUpdate((n) => ({
                ...n,
                textResizing: e.target.value as TextNode['textResizing'],
              }))
            }
          >
            {RESIZING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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
          ['fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing'].includes(
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
    <DisclosureSection title="OpenType Features" defaultExpanded={false}>
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
  const isVariable = family ? registry.isVariable(family) : false;
  const allAxes = registry.getAllAxes();

  const currentAxes = commonValue(textNodes, (n) => (n as TextNode).variableAxes ?? {});
  const axesMap = isMixed(currentAxes) ? {} : currentAxes;

  if (!isVariable) return null;

  const familyAxes = registry.getVariableAxes(family);
  const activeAxisTags = familyAxes ? Object.keys(familyAxes) : allAxes.map((a) => a.tag);

  const setAxis = useCallback(
    (tag: string, value: number) => {
      batchUpdate((n) => ({
        ...n,
        variableAxes: { ...(n.variableAxes ?? {}), [tag]: value },
      }));
    },
    [batchUpdate],
  );

  return (
    <DisclosureSection title="Variable Font Axes" defaultExpanded={false}>
      {activeAxisTags.map((tag) => {
        const info = registry.getAxisInfo(tag);
        if (!info) return null;
        const value = axesMap[tag] ?? info.default;
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
                  step={(info.max - info.min) / 100}
                  value={value}
                  onChange={(e) => setAxis(tag, Number(e.target.value))}
                  aria-label={info.name}
                  aria-valuemin={info.min}
                  aria-valuemax={info.max}
                  aria-valuenow={value}
                />
                <span className="insp-slider__value">{value}</span>
              </div>
            </div>
          </div>
        );
      })}
    </DisclosureSection>
  );
}
