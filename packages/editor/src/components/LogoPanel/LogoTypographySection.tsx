/**
 * LogoTypographySection — wordmark-level typography for the Logo panel.
 *
 * Shows standard wordmark controls (text, font family, size, tracking) for
 * the selected text node plus the shared GlyphTypographySection (kerning
 * mode, per-cluster adjustments, pair spacing, convert to outlines), so the
 * full glyph-refinement workflow is available visually in the Logo panel.
 */

import type { TextNode } from '@varve/scene';
import { NumberInput } from '@varve/ui';
import { useMemo } from 'react';
import { useEditor } from '../../context';
import { GlyphTypographySection } from '../Typography/GlyphTypographySection';

export function LogoTypographySection({ node }: { node: TextNode }) {
  const editor = useEditor();
  const nodeId = node.id;

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
      <label className="logo-panel__field">
        <span className="logo-panel__field-label">Wordmark text</span>
        <input
          className="logo-panel__text-input"
          type="text"
          value={node.text ?? ''}
          onChange={(e) => patch({ text: e.target.value })}
        />
      </label>
      <div className="logo-panel__field">
        <span className="logo-panel__field-label">Font</span>
        <input
          className="logo-panel__text-input"
          type="text"
          value={node.fontFamily ?? ''}
          placeholder="Font family"
          onChange={(e) => patch({ fontFamily: e.target.value || undefined })}
        />
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
