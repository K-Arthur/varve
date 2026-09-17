/**
 * TypographySection — font and text-style controls for TextNode selections.
 *
 * Full property set: family, weight, style, size, line-height, letter-spacing,
 * paragraph spacing, text align (h/v), text case, decoration, list style,
 * truncation/overflow, resizing mode, and face-aware OpenType features.
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
import {
  invalidateGlyphAdjustmentsOnTextChange,
  plainTextToRichText,
  replaceRichTextContent,
  resolveNodeFills,
  richTextToPlainText,
  textNodeGeometry,
} from '@varve/scene';
import { Icon, Select, Switch, Tooltip } from '@varve/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { docVariableStore } from '../../../docVariableStore';
import type { FontFaceSelection } from '../../FontBrowser/FontBrowser';
import { FontBrowserDialog } from '../../FontBrowser/FontBrowserDialog';
import { FontSelector } from '../../FontBrowser/FontSelector';
import { AdvancedOpenTypeFeaturesSection } from '../../Typography/AdvancedOpenTypeFeaturesSection';
import {
  fontFamilyChanges,
  fontStyleAvailable,
  fontStyleChanges,
  fontWeightChanges,
  fontWeightOptions,
} from '../../Typography/fontWeight';
import { GlyphTypographySection } from '../../Typography/GlyphTypographySection';
import {
  applyTypographyChanges,
  type TypographyCommandSurface,
  type TypographyTextChanges,
} from '../../Typography/typographyCommand';
import { useTypographyPreview } from '../../Typography/useTypographyPreview';
import { BindingMenu } from '../controls/BindingMenu';
import { ContrastIndicator } from '../controls/ContrastIndicator';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow, InspectorFieldGroup } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { RangeValueControl } from '../controls/RangeValueControl';
import { RichTextSpanEditor } from '../controls/RichTextSpanEditor';
import type { SegmentedOption } from '../controls/SegmentedControl';
import { SegmentedControl } from '../controls/SegmentedControl';
import { commonValue, isMixed, type MaybeMixed } from '../selection/selectionState';
import './TypographySection.css';

/**
 * Switch a text node's resizing contract, keeping `w`/`h` meaning what the new
 * mode says they mean.
 *
 * `w`/`h` are container geometry. A mode that has no container must not keep
 * them — they would sit in the document as a measurement nothing honours, and
 * the Inspector would report a size the canvas does not use. A mode that does
 * have a container needs one to exist, so it is materialised from the layout
 * the node currently occupies rather than left undefined for the next edit to
 * invent.
 */
function applyTextResizing(node: TextNode, mode: TextNode['textResizing']): TextNode {
  const geometry = textNodeGeometry(node);
  if (mode === 'autoWidth') {
    const { w: _w, h: _h, ...rest } = node;
    return { ...rest, textResizing: mode, textMode: node.textMode === 'path' ? 'path' : 'point' };
  }
  if (mode === 'autoHeight') {
    const { h: _h, ...rest } = node;
    return {
      ...rest,
      textResizing: mode,
      textMode: node.textMode === 'path' ? 'path' : 'area',
      w: node.w ?? geometry.bounds.w,
    };
  }
  return {
    ...node,
    textResizing: mode,
    textMode: node.textMode === 'path' ? 'path' : 'area',
    w: node.w ?? geometry.bounds.w,
    h: node.h ?? geometry.bounds.h,
  };
}

export interface TypographySectionProps {
  nodes: SceneNode[];
}

const DIRECTION_OPTIONS: readonly SegmentedOption<'auto' | 'ltr' | 'rtl'>[] = [
  { value: 'auto', label: 'Auto', tooltip: 'Detect direction from the text content' },
  { value: 'ltr', label: 'LTR', tooltip: 'Left-to-right, e.g. Latin scripts' },
  { value: 'rtl', label: 'RTL', tooltip: 'Right-to-left, e.g. Arabic or Hebrew' },
] as const;

const WRITING_MODE_OPTIONS: readonly {
  value: NonNullable<TextNode['writingMode']>;
  label: string;
  description: string;
}[] = [
  {
    value: 'horizontal-tb',
    label: 'Horizontal',
    description: 'Lines run left to right, stacked top to bottom',
  },
  {
    value: 'vertical-rl',
    label: 'Vertical, right to left',
    description: 'Lines run top to bottom, columns stack right to left',
  },
  {
    value: 'vertical-lr',
    label: 'Vertical, left to right',
    description: 'Lines run top to bottom, columns stack left to right',
  },
];

const TEXT_ORIENTATION_OPTIONS: readonly {
  value: NonNullable<TextNode['textOrientation']>;
  label: string;
  description: string;
}[] = [
  { value: 'mixed', label: 'Mixed', description: 'Rotate Latin text, keep CJK upright' },
  { value: 'upright', label: 'Upright', description: 'Keep every glyph upright' },
  { value: 'sideways', label: 'Sideways', description: 'Rotate every glyph 90 degrees' },
];

// Alignment is the most-recognised icon family in design tools; the single
// letters (L/C/R/J, T/M/B) it replaces were unreadable without a legend.
const TEXT_ALIGN_OPTIONS: readonly SegmentedOption<'left' | 'center' | 'right' | 'justify'>[] = [
  { value: 'left', label: 'Align left', icon: 'TextAlignStart', hideLabel: true },
  { value: 'center', label: 'Align center', icon: 'TextAlignCenter', hideLabel: true },
  { value: 'right', label: 'Align right', icon: 'TextAlignEnd', hideLabel: true },
  { value: 'justify', label: 'Justify', icon: 'TextAlignJustify', hideLabel: true },
] as const;

const TEXT_ALIGN_V_OPTIONS: readonly SegmentedOption<'top' | 'middle' | 'bottom'>[] = [
  { value: 'top', label: 'Align top', icon: 'AlignStartVertical', hideLabel: true },
  { value: 'middle', label: 'Align middle', icon: 'AlignCenterVertical', hideLabel: true },
  { value: 'bottom', label: 'Align bottom', icon: 'AlignEndVertical', hideLabel: true },
] as const;

// Case transforms read as their own output: "ABC" uppercases, "abc"
// lowercases, "Abc" title-cases. That is self-describing in a way that a
// generic "Aa"/"AA" pair never was.
const TEXT_CASE_OPTIONS: readonly SegmentedOption<
  'none' | 'uppercase' | 'lowercase' | 'capitalize'
>[] = [
  { value: 'none', label: 'None', tooltip: 'Use the text exactly as typed' },
  { value: 'uppercase', label: 'ABC', tooltip: 'UPPERCASE' },
  { value: 'lowercase', label: 'abc', tooltip: 'lowercase' },
  { value: 'capitalize', label: 'Abc', tooltip: 'Title Case each word' },
] as const;

const TEXT_DECORATION_OPTIONS: readonly SegmentedOption<'none' | 'underline' | 'line-through'>[] = [
  { value: 'none', label: 'No decoration', icon: 'Minus', hideLabel: true },
  { value: 'underline', label: 'Underline', icon: 'Underline', hideLabel: true },
  { value: 'line-through', label: 'Strikethrough', icon: 'Strikethrough', hideLabel: true },
] as const;

const FONT_STYLE_OPTIONS: readonly SegmentedOption<'normal' | 'italic'>[] = [
  { value: 'normal', label: 'Regular', tooltip: 'Upright roman face' },
  { value: 'italic', label: 'Italic', tooltip: 'True italic face when the font provides one' },
] as const;

const LIST_STYLE_OPTIONS: { value: TextNode['listStyle']; label: string; description?: string }[] =
  [
    { value: 'none', label: 'None' },
    { value: 'disc', label: 'Bullet (•)' },
    { value: 'decimal', label: 'Numbered (1.)' },
    { value: 'circle', label: 'Circle' },
    { value: 'square', label: 'Square' },
  ];

const OVERFLOW_OPTIONS: { value: TextNode['textOverflow']; label: string; description: string }[] =
  [
    {
      value: 'visible',
      label: 'Visible',
      description: 'Let the text paint outside its bounds',
    },
    {
      value: 'clip',
      label: 'Clip',
      description: 'Cut off anything past the edges',
    },
    {
      value: 'ellipsis',
      label: 'Ellipsis (…)',
      description: 'Fade the end of the last visible line',
    },
  ];

const RESIZING_OPTIONS: { value: TextNode['textResizing']; label: string; description: string }[] =
  [
    {
      value: 'autoWidth',
      label: 'Auto width',
      description: 'The box hugs a single line of text',
    },
    {
      value: 'autoHeight',
      label: 'Auto height',
      description: 'Fixed width, height follows the wrapped text',
    },
    {
      value: 'fixed',
      label: 'Fixed size',
      description: 'Both edges are controlled and text can overflow',
    },
  ];

/**
 * Advanced typography properties the common case never touches. Used for the
 * subsection badge so a collapsed "Advanced typography" still tells the user
 * that the current layer already uses one of them.
 */
function advancedTypographyCount(nodes: TextNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if ((node.tracking ?? 0) !== 0) count += 1;
    if ((node.paragraphSpacing ?? 0) !== 0) count += 1;
    if ((node.textCase ?? 'none') !== 'none') count += 1;
    if ((node.textDecoration ?? 'none') !== 'none') count += 1;
    if ((node.listStyle ?? 'none') !== 'none') count += 1;
    if ((node.textOverflow ?? 'visible') !== 'visible') count += 1;
    // Text sizing is only "set" when it differs from the mode's natural
    // default: point text is auto-width, area/path text keeps its container.
    // Counting a freshly created point-text layer here made every text layer
    // report "1 set" for a property the user never touched.
    const naturalResizing = node.textMode === 'area' ? 'fixed' : 'autoWidth';
    if ((node.textResizing ?? naturalResizing) !== naturalResizing) count += 1;
    if ((node.direction ?? 'auto') !== 'auto') count += 1;
    if ((node.writingMode ?? 'horizontal-tb') !== 'horizontal-tb') count += 1;
    if ((node.textOrientation ?? 'mixed') !== 'mixed') count += 1;
    if ((node.textAlignVertical ?? 'top') !== 'top') count += 1;
  }
  return count;
}

function getTextValue<T>(n: SceneNode, accessor: (t: TextNode) => T): T {
  return accessor(n as TextNode);
}

/** Manual per-cluster and pair adjustments currently applied to one node. */
function glyphAdjustmentCount(node: TextNode): number {
  return (
    Object.keys(node.glyphAdjustments ?? {}).length + Object.keys(node.pairAdjustments ?? {}).length
  );
}

export function TypographySection({ nodes }: TypographySectionProps) {
  const editor = useEditor();
  const registry = useMemo(() => getFontRegistry(), []);
  const {
    updateNode,
    beginTransaction,
    commitTransaction,
    abortTransaction,
    setBindingField,
    bindingField,
    setSelectedBinding,
    applyFormatToSelection,
    setPendingFormat,
    groupCompoundOperation,
  } = editor;
  const bindingTriggerRef = useRef<HTMLDivElement>(null);
  const [richTextEnabled, setRichTextEnabled] = useState(false);
  const [fontBrowserOpen, setFontBrowserOpen] = useState(false);

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

  const typographySurface = useMemo<TypographyCommandSurface>(
    () => ({
      selectedIds: editor.state.selection,
      selectionRange: editor.state.selectionRange,
      pendingFormat: editor.state.pendingFormat,
      updateNode,
      applyFormatToSelection,
      setPendingFormat,
      groupCompoundOperation,
    }),
    [
      applyFormatToSelection,
      editor.state.pendingFormat,
      editor.state.selection,
      editor.state.selectionRange,
      groupCompoundOperation,
      setPendingFormat,
      updateNode,
    ],
  );

  const applyTypographyToSelection = useCallback(
    (changes: TypographyTextChanges) => {
      const onlyNode = textNodes.length === 1 ? textNodes[0] : undefined;
      if (onlyNode) {
        applyTypographyChanges(typographySurface, onlyNode.id, changes);
        return;
      }
      batchUpdate((node) => ({ ...node, ...changes }));
    },
    [batchUpdate, textNodes, typographySurface],
  );

  const typographyTargetKey = textNodes
    .map((node) => node.id)
    .sort()
    .join(',');
  const {
    previewChanges: previewTypographyChanges,
    commitChanges: commitTypographyChanges,
    clearPreview: clearTypographyPreview,
  } = useTypographyPreview(applyTypographyToSelection, {
    beginPreview: () => beginTransaction('preview'),
    commitPreview: commitTransaction,
    abortPreview: abortTransaction,
    resetKey: typographyTargetKey,
  });

  const textContent = useMemo(() => {
    const textVals = textNodes.map((n) => (n.richText ? richTextToPlainText(n.richText) : n.text));
    return textVals.every((v) => v === textVals[0]) ? textVals[0] : '(Mixed)';
  }, [textNodes]);

  const handleTextChange = useCallback(
    (text: string) => {
      beginTransaction();
      for (const n of textNodes) {
        updateNode(n.id, (node) => {
          if (node.kind !== 'text') return node;
          const rich = node.richText ?? plainTextToRichText(node.text);
          const nextRich = replaceRichTextContent(rich, text);
          const nextText = richTextToPlainText(nextRich);
          const nextNode = node.richText
            ? { ...node, text: nextText, richText: nextRich }
            : { ...node, text: nextText };
          return invalidateGlyphAdjustmentsOnTextChange(node, nextNode);
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
  const writingModeRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.writingMode ?? 'horizontal-tb'),
  );
  const textOrientationRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.textOrientation ?? 'mixed'),
  );
  const alignVRaw = commonValue(textNodes, (n) =>
    getTextValue(n, (t) => t.textAlignVertical ?? 'top'),
  );
  const typographyDraftKey = typographyTargetKey;
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
  const italicAvailable = textNodes.every(
    (node) =>
      (node.fontStyle ?? 'normal') === 'italic' || fontStyleAvailable(node, 'italic', registry),
  );
  const fontStyleOptions = useMemo(
    () =>
      FONT_STYLE_OPTIONS.map((option) =>
        option.value === 'italic' && !italicAvailable
          ? {
              ...option,
              disabled: true,
              disabledReason: 'This font has no real italic face for the selection',
            }
          : option,
      ),
    [italicAvailable],
  );
  // Vertical alignment and text flow only exist once the text has a container;
  // a point-text layer has no box for either to act on. The node's textMode is
  // the model's own answer (created point text carries textResizing
  // 'autoWidth'), with textResizing as a fallback for older documents.
  const isAreaText = textNodes.some((node) => {
    if (node.textMode === 'area') return true;
    if (node.textMode === 'path' || node.textMode === 'point') return false;
    if (node.textResizing === 'autoHeight' || node.textResizing === 'fixed') return true;
    if (node.textResizing === 'autoWidth') return false;
    return true;
  });
  // Orientation only affects a vertical writing mode, so hide it until the
  // selection actually writes vertically (the previous always-on select wrote
  // values the renderer ignored).
  const isVerticalWriting = textNodes.some(
    (node) => (node.writingMode ?? 'horizontal-tb') !== 'horizontal-tb',
  );
  const advancedCount = advancedTypographyCount(textNodes);

  return (
    <DisclosureSection title="Typography" sectionId="typography">
      <FontBrowserDialog
        open={fontBrowserOpen}
        onClose={() => setFontBrowserOpen(false)}
        selectedFamily={isMixed(familyRaw) ? undefined : familyRaw}
        documentId={editor.state.document.id}
        onSelect={(family) => {
          applyTypographyToSelection(fontFamilyChanges(family || undefined));
          setFontBrowserOpen(false);
        }}
        onSelectFace={(selection: FontFaceSelection) => {
          applyTypographyToSelection({
            fontFamily: selection.family,
            fontWeight: selection.weight,
            fontStyle: selection.style,
            fontReference: selection.fontReference,
            variableAxes: selection.variableAxes,
          });
          setFontBrowserOpen(false);
        }}
      />
      <div ref={bindingTriggerRef} className="insp-field-group typography-controls">
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
            {textNodes.length === 1 && (
              <FieldRow label="Rich text">
                <Switch
                  aria-label="Enable rich text editing"
                  className="insp-switch"
                  checked={richTextEnabled}
                  onChange={(event) => setRichTextEnabled(event.target.checked)}
                />
              </FieldRow>
            )}
            {textNodes.length === 1 && (
              <FieldRow label="Layer name">
                <button
                  type="button"
                  className="insp-btn-sm"
                  onClick={() => editor.restoreAutomaticTextName(textNodes[0]!.id)}
                  aria-label="Use text content as layer name"
                >
                  {textNodes[0]!.nameMode === 'automatic' ? 'Following text' : 'Use text as name'}
                </button>
              </FieldRow>
            )}
          </>
        )}
        <div className="typography__family-field">
          <FontSelector
            value={isMixed(familyRaw) ? '' : familyRaw}
            fontReference={textNodes.length === 1 ? textNodes[0]?.fontReference : undefined}
            variableAxes={textNodes.length === 1 ? textNodes[0]?.variableAxes : undefined}
            mixed={isMixed(familyRaw)}
            onChange={(v) => commitTypographyChanges(fontFamilyChanges(v || undefined))}
            onPreviewFamily={(v) => previewTypographyChanges(fontFamilyChanges(v || undefined))}
            onClearPreview={clearTypographyPreview}
            onSelectFace={(selection) =>
              commitTypographyChanges({
                fontFamily: selection.family,
                fontWeight: selection.weight,
                fontStyle: selection.style,
                fontReference: selection.fontReference,
                variableAxes: selection.variableAxes,
              })
            }
            onPreviewFace={(selection) =>
              previewTypographyChanges({
                fontFamily: selection.family,
                fontWeight: selection.weight,
                fontStyle: selection.style,
                fontReference: selection.fontReference,
                variableAxes: selection.variableAxes,
              })
            }
          />
          <Tooltip label="Browse fonts">
            <button
              type="button"
              className="typography__browse-fonts"
              onClick={() => setFontBrowserOpen(true)}
              aria-label="Browse fonts"
            >
              <Icon name="Ellipsis" size={16} />
            </button>
          </Tooltip>
        </div>
        <InspectorFieldGroup columns={2} className="typography__paired-fields">
          <FieldRow label="Weight">
            <Select
              label="Font weight"
              value={isMixed(weightRaw) ? '400' : String(weightRaw)}
              placeholder={isMixed(weightRaw) ? 'Mixed' : undefined}
              options={fontWeightOptions(textNodes).map((option) => ({
                value: String(option.value),
                label: option.label,
                disabled: option.disabled,
                disabledReason: option.disabledReason,
              }))}
              onChange={(v) =>
                textNodes.length === 1
                  ? applyTypographyToSelection(fontWeightChanges(textNodes[0]!, Number(v)))
                  : batchUpdate((n) => ({ ...n, ...fontWeightChanges(n, Number(v)) }))
              }
            />
          </FieldRow>
          <FieldRow label="Style">
            <SegmentedControl
              label="Font style"
              value={isMixed(styleRaw) ? 'normal' : styleRaw}
              options={fontStyleOptions}
              onChange={(v) =>
                textNodes.length === 1
                  ? applyTypographyToSelection(fontStyleChanges(textNodes[0]!, v))
                  : batchUpdate((n) => ({ ...n, ...fontStyleChanges(n, v) }))
              }
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
        </InspectorFieldGroup>
        <InspectorFieldGroup columns={2} className="typography__paired-fields">
          <NumberField
            label="Size"
            unit="px"
            value={isMixed(sizeRaw) ? 16 : sizeRaw}
            mixed={isMixed(sizeRaw)}
            step={1}
            min={0}
            fieldName="fontSize"
            draftKey={`${typographyDraftKey}:font-size`}
            onShiftClick={() => setBindingField('fontSize')}
            onChange={(v) => applyTypographyToSelection({ fontSize: v })}
          />
          <NumberField
            label="Line height"
            unit="%"
            value={isMixed(lineHeightRaw) ? 120 : lineHeightRaw * 100}
            mixed={isMixed(lineHeightRaw)}
            step={1}
            min={0}
            fieldName="lineHeight"
            draftKey={`${typographyDraftKey}:line-height`}
            onShiftClick={() => setBindingField('lineHeight')}
            onChange={(v) => applyTypographyToSelection({ lineHeight: v / 100 })}
          />
        </InspectorFieldGroup>
        <NumberField
          label="Letter spacing"
          labelWrap
          unit="px"
          value={isMixed(letterSpacingRaw) ? 0 : letterSpacingRaw}
          mixed={isMixed(letterSpacingRaw)}
          step={0.1}
          fieldName="letterSpacing"
          draftKey={`${typographyDraftKey}:letter-spacing`}
          onShiftClick={() => setBindingField('letterSpacing')}
          onChange={(v) => applyTypographyToSelection({ letterSpacing: v })}
        />
        <FieldRow label="Alignment">
          <SegmentedControl
            label="Horizontal align"
            value={isMixed(alignRaw) ? 'left' : alignRaw}
            options={TEXT_ALIGN_OPTIONS}
            onChange={(v) => batchUpdate((n) => ({ ...n, textAlign: v }))}
          />
        </FieldRow>
        <DisclosureSection
          title="Advanced typography"
          sectionId="typography"
          subsectionId="advancedText"
          action={
            advancedCount > 0 ? (
              <span className="typography__count">{advancedCount} set</span>
            ) : undefined
          }
        >
          <NumberField
            label="Tracking"
            labelWrap
            unit="‰"
            value={isMixed(trackingRaw) ? 0 : trackingRaw}
            mixed={isMixed(trackingRaw)}
            step={10}
            fieldName="tracking"
            draftKey={`${typographyDraftKey}:tracking`}
            onShiftClick={() => setBindingField('tracking')}
            onChange={(v) => applyTypographyToSelection({ tracking: v })}
          />
          <p className="insp-field__hint">
            Tracking scales with font size (‰); Letter spacing above is fixed px.
          </p>
          <NumberField
            label="Paragraph spacing"
            labelWrap
            unit="px"
            value={isMixed(paraSpacingRaw) ? 0 : paraSpacingRaw}
            mixed={isMixed(paraSpacingRaw)}
            step={1}
            min={0}
            fieldName="paragraphSpacing"
            draftKey={`${typographyDraftKey}:paragraph-spacing`}
            onShiftClick={() => setBindingField('paragraphSpacing')}
            onChange={(v) => batchUpdate((n) => ({ ...n, paragraphSpacing: v }))}
          />
          <FieldRow label="Direction">
            <SegmentedControl
              label="Text direction"
              value={isMixed(directionRaw) ? 'auto' : directionRaw}
              options={DIRECTION_OPTIONS}
              onChange={(v) => batchUpdate((n) => ({ ...n, direction: v }))}
            />
          </FieldRow>
          <FieldRow label="Writing mode">
            <Select
              label="Writing mode (not rotation)"
              value={isMixed(writingModeRaw) ? 'horizontal-tb' : writingModeRaw}
              options={WRITING_MODE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
                description: option.description,
              }))}
              onChange={(value) =>
                batchUpdate((n) => ({
                  ...n,
                  writingMode: value as TextNode['writingMode'],
                }))
              }
            />
          </FieldRow>
          {isVerticalWriting && (
            <FieldRow label="Vertical orientation" wrapLabel>
              <Select
                label="Vertical text orientation"
                value={isMixed(textOrientationRaw) ? 'mixed' : textOrientationRaw}
                options={TEXT_ORIENTATION_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                  description: option.description,
                }))}
                onChange={(value) =>
                  batchUpdate((n) => ({
                    ...n,
                    textOrientation: value as TextNode['textOrientation'],
                  }))
                }
              />
            </FieldRow>
          )}
          {isAreaText && (
            <FieldRow label="Vertical align">
              <SegmentedControl
                label="Text vertical align"
                value={isMixed(alignVRaw) ? 'top' : alignVRaw}
                options={TEXT_ALIGN_V_OPTIONS}
                onChange={(v) => batchUpdate((n) => ({ ...n, textAlignVertical: v }))}
              />
            </FieldRow>
          )}
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
          <FieldRow label="List style">
            <Select
              label="List style"
              value={isMixed(listRaw) ? 'none' : listRaw}
              options={LIST_STYLE_OPTIONS.map((o) => ({
                value: o.value as string,
                label: o.label,
                description: o.description,
              }))}
              onChange={(v) =>
                batchUpdate((n) => ({ ...n, listStyle: v as TextNode['listStyle'] }))
              }
            />
          </FieldRow>
          {isAreaText && (
            <>
              <FieldRow label="Text sizing">
                <Select
                  label="Text resizing mode"
                  value={isMixed(resizingRaw) ? 'fixed' : resizingRaw}
                  options={RESIZING_OPTIONS.map((o) => ({
                    value: o.value as string,
                    label: o.label,
                    description: o.description,
                  }))}
                  onChange={(v) =>
                    batchUpdate((n) => applyTextResizing(n, v as TextNode['textResizing']))
                  }
                />
              </FieldRow>
              <FieldRow label="Overflow">
                <Select
                  label="Text overflow"
                  value={isMixed(overflowRaw) ? 'visible' : overflowRaw}
                  options={OVERFLOW_OPTIONS.map((o) => ({
                    value: o.value as string,
                    label: o.label,
                    description: o.description,
                  }))}
                  onChange={(v) =>
                    batchUpdate((n) => ({
                      ...n,
                      textOverflow: v as TextNode['textOverflow'],
                    }))
                  }
                />
              </FieldRow>
            </>
          )}
        </DisclosureSection>
        {/* OpenType features */}
        <AdvancedOpenTypeFeaturesSection
          textNodes={textNodes}
          familyRaw={familyRaw}
          applyChanges={applyTypographyToSelection}
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
          <DisclosureSection
            title="Glyph adjustments"
            sectionId="typography"
            subsectionId="glyphAdjustments"
            action={
              glyphAdjustmentCount(textNodes[0]!) > 0 ? (
                <span className="typography__count">{glyphAdjustmentCount(textNodes[0]!)}</span>
              ) : undefined
            }
          >
            <GlyphTypographySection
              node={textNodes[0]!}
              onConvertToOutlines={() => editor.convertTextToOutlines()}
            />
          </DisclosureSection>
        </div>
      )}
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
          <FieldRow key={tag} label={info.name} htmlFor={`vf-${tag}-range`}>
            <div className="insp-axis-control">
              <RangeValueControl
                id={`vf-${tag}`}
                label={`${info.name} (${tag})`}
                value={value}
                min={info.min}
                max={info.max}
                step={step}
                rangeClassName="insp-slider__input"
                rangeAriaLabel={`${info.name} (${tag})`}
                onChange={(nextValue) => setAxis(tag, nextValue)}
              />
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
          </FieldRow>
        );
      })}
    </DisclosureSection>
  );
}
