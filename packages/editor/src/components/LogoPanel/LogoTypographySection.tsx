/**
 * LogoTypographySection — wordmark-level typography for the Logo panel.
 *
 * Shows standard wordmark controls (text, font family, size, tracking) for
 * the selected text node plus the shared GlyphTypographySection (kerning
 * mode, per-cluster adjustments, pair spacing, convert to outlines), so the
 * full glyph-refinement workflow is available visually in the Logo panel.
 */

import type { TextNode } from '@varve/scene';
import { Button, Icon, NumberInput, Select } from '@varve/ui';
import { useMemo, useState } from 'react';
import { useEditor } from '../../context';
import type { FontFaceSelection } from '../FontBrowser/FontBrowser';
import { FontBrowserDialog } from '../FontBrowser/FontBrowserDialog';
import { FontSelector } from '../FontBrowser/FontSelector';
import { fontFamilyChanges, fontWeightChanges, fontWeightOptions } from '../Typography/fontWeight';
import { GlyphTypographySection } from '../Typography/GlyphTypographySection';

export function LogoTypographySection({ node }: { node: TextNode }) {
  const editor = useEditor();
  const nodeId = node.id;
  const [fontBrowserOpen, setFontBrowserOpen] = useState(false);

  const patch = useMemo(
    () => (patch: Partial<TextNode>) => {
      editor.updateDoc((doc) => ({
        ...doc,
        nodes: {
          ...doc.nodes,
          [nodeId]: { ...(doc.nodes[nodeId] as TextNode), ...patch },
        },
      }));
    },
    [editor, nodeId],
  );

  return (
    <div className="logo-panel__section-body">
      <FontBrowserDialog
        open={fontBrowserOpen}
        onClose={() => setFontBrowserOpen(false)}
        selectedFamily={node.fontFamily}
        onSelect={(family) => {
          patch(fontFamilyChanges(family || undefined));
          setFontBrowserOpen(false);
        }}
        onSelectFace={(selection: FontFaceSelection) => {
          const weightChanges = fontWeightChanges(
            { ...node, fontFamily: selection.family },
            selection.weight,
          );
          patch({
            ...fontFamilyChanges(selection.family),
            fontReference: selection.fontReference,
            ...weightChanges,
            fontStyle: selection.style,
            variableAxes: selection.variableAxes ?? weightChanges.variableAxes,
          });
          setFontBrowserOpen(false);
        }}
      />
      <label className="logo-panel__field">
        <span className="logo-panel__field-label">Wordmark text</span>
        <input
          className="logo-panel__text-input"
          type="text"
          value={node.text ?? ''}
          onChange={(e) => patch({ text: e.target.value })}
        />
      </label>
      <div className="logo-panel__field logo-panel__font-field">
        <FontSelector
          value={node.fontFamily ?? ''}
          fontReference={node.fontReference}
          label="Font family"
          onChange={(family) => patch(fontFamilyChanges(family || undefined))}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="logo-panel__font-browse"
          onClick={() => setFontBrowserOpen(true)}
          aria-label="Browse fonts for wordmark"
        >
          <Icon name="Search" size={14} />
          Browse fonts
        </Button>
      </div>
      <div className="logo-panel__field">
        <span className="logo-panel__field-label">Weight and style</span>
        <div className="logo-panel__button-row">
          <Select
            label="Font weight"
            value={String(node.fontWeight ?? 400)}
            options={fontWeightOptions(node).map((option) => ({
              value: String(option.value),
              label: option.label,
              disabled: option.disabled,
              disabledReason: option.disabledReason,
            }))}
            onChange={(value) => patch(fontWeightChanges(node, Number(value)))}
          />
          <Select
            label="Font style"
            value={node.fontStyle ?? 'normal'}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'italic', label: 'Italic' },
            ]}
            onChange={(fontStyle) => patch({ fontStyle: fontStyle as TextNode['fontStyle'] })}
          />
        </div>
      </div>
      <div className="logo-panel__field">
        <span className="logo-panel__field-label">Size and tracking</span>
        <div className="logo-panel__button-row">
          <NumberInput
            label="Size"
            value={node.fontSize}
            step={1}
            min={1}
            max={1000}
            onChange={(fontSize) => patch({ fontSize })}
          />
          <NumberInput
            label="Tracking"
            value={node.tracking ?? 0}
            step={1}
            min={-1000}
            max={1000}
            onChange={(tracking) => patch({ tracking })}
          />
        </div>
      </div>
      <GlyphTypographySection
        node={node}
        onConvertToOutlines={() => editor.convertTextToOutlines()}
      />
    </div>
  );
}
