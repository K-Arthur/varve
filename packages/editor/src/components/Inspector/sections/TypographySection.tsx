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
import type { SceneNode, TextNode } from '@strata/scene';
import { useCallback, useMemo, useRef } from 'react';
import { useEditor } from '../../../context';
import { BindingMenu } from '../controls/BindingMenu';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import type { SegmentedOption } from '../controls/SegmentedControl';
import { SegmentedControl } from '../controls/SegmentedControl';
import { commonValue, isMixed } from '../selection/selectionState';

export interface TypographySectionProps {
  nodes: SceneNode[];
}

// TODO: Replace with FontRegistry once the local-first font system lands
// (Strata plan Phase 2 — Assets). Kept as a static list for offline use.
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
      <div ref={bindingTriggerRef} className="insp-field" style={{ position: 'relative' }}>
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
            {SYSTEM_FONTS.map((f) => (
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
        {/* OpenType features — stub until font system exposes them */}
        <div className="insp-empty-message" style={{ paddingTop: 'var(--space-1)' }}>
          OpenType features available once FontRegistry lands
        </div>
        {/* Binding menu for typography numeric fields */}
        {bindingField &&
          ['fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing'].includes(
            bindingField,
          ) && (
            <BindingMenu
              variableStore={editor.state.variableStore as import('@strata/scene').VariableStore}
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
