/**
 * TypographySection — font and text-style controls for TextNode selections.
 *
 * Multi-select: every control uses commonValue and shows "Mixed" when values
 * differ. Editing applies to all selected text nodes via batch update in one
 * undo step.
 *
 * Research basis: Figma / Sketch typography panel, APG Disclosure pattern.
 */
import type { SceneNode, TextNode } from '@strata/scene';
import { useCallback, useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import type { SegmentedOption } from '../controls/SegmentedControl';
import { SegmentedControl } from '../controls/SegmentedControl';
import { commonValue, isMixed } from '../selection/selectionState';

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

const TEXT_ALIGN_OPTIONS: readonly SegmentedOption<'left' | 'center' | 'right' | 'justify'>[] = [
  { value: 'left', label: 'L' },
  { value: 'center', label: 'C' },
  { value: 'right', label: 'R' },
  { value: 'justify', label: 'J' },
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

function getTextValue<T>(n: SceneNode, accessor: (t: TextNode) => T): T {
  return accessor(n as TextNode);
}

export function TypographySection({ nodes }: TypographySectionProps) {
  const { updateNode, beginTransaction, commitTransaction } = useEditor();

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

  if (textNodes.length === 0) return null;

  const familyRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.fontFamily ?? ''));
  const weightRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.fontWeight ?? 400));
  const sizeRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.fontSize));
  const lineHeightRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.lineHeight ?? 1.2));
  const letterSpacingRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.letterSpacing ?? 0),
  );
  const alignRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.textAlign ?? 'left'));
  const caseRaw = commonValue(textNodes, (n) => getTextValue(n, (t) => t.textCase ?? 'none'));
  const decorationRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.textDecoration ?? 'none'),
  );

  return (
    <DisclosureSection title="Typography">
      <FieldRow label="Font" htmlFor="typography-font">
        <select
          id="typography-font"
          aria-label="Font family"
          value={isMixed(familyRaw) ? '' : familyRaw}
          style={SELECT_STYLE}
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
      <NumberField
        label="Weight"
        value={isMixed(weightRaw) ? 400 : weightRaw}
        mixed={isMixed(weightRaw)}
        step={100}
        min={100}
        max={900}
        onChange={(v) => batchUpdate((n) => ({ ...n, fontWeight: v }))}
      />
      <NumberField
        label="Size"
        unit="px"
        value={isMixed(sizeRaw) ? 16 : sizeRaw}
        mixed={isMixed(sizeRaw)}
        step={1}
        min={0}
        onChange={(v) => batchUpdate((n) => ({ ...n, fontSize: v }))}
      />
      <NumberField
        label="Line height"
        unit="%"
        value={isMixed(lineHeightRaw) ? 1.2 : lineHeightRaw}
        mixed={isMixed(lineHeightRaw)}
        step={0.1}
        min={0}
        onChange={(v) => batchUpdate((n) => ({ ...n, lineHeight: v }))}
      />
      <NumberField
        label="Letter spacing"
        unit="px"
        value={isMixed(letterSpacingRaw) ? 0 : letterSpacingRaw}
        mixed={isMixed(letterSpacingRaw)}
        step={0.1}
        onChange={(v) => batchUpdate((n) => ({ ...n, letterSpacing: v }))}
      />
      <FieldRow label="Align">
        <SegmentedControl
          label="Text align"
          value={isMixed(alignRaw) ? 'left' : alignRaw}
          options={TEXT_ALIGN_OPTIONS}
          onChange={(v) => batchUpdate((n) => ({ ...n, textAlign: v }))}
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
    </DisclosureSection>
  );
}
