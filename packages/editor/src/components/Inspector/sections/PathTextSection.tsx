/**
 * Text-on-path controls.
 *
 * The engine has placed glyphs along any of the nine shape kinds for some
 * time (`placeGlyphsOnPath` in @varve/engine, wired through the replay
 * painter and both render pipelines), and the document model has carried
 * `textMode: 'path'` with a `pathTextSettings` record alongside it. Nothing
 * in the editor ever set either one, so the capability had no way in. This
 * section is that way in: it attaches a text node to a selected path and
 * exposes the settings the renderer actually reads.
 *
 * Deliberately narrow: `startOffset` and `side` are the two fields
 * `paintPathText` consumes today. `flip`, `endOffset` and `baselineShift`
 * exist on the type but are not read by the renderer, so offering controls
 * for them would present settings that do nothing.
 */
import type { SceneNode, TextNode } from '@varve/scene';
import { useCallback } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { SegmentedControl } from '../controls/SegmentedControl';

interface PathTextSectionProps {
  nodes: SceneNode[];
}

export function PathTextSection({ nodes }: PathTextSectionProps) {
  const { state, updateNode, beginTransaction, commitTransaction, announce } = useEditor();

  const textNodes = nodes.filter((n): n is TextNode => n.kind === 'text');
  const textNode = textNodes.length === 1 ? textNodes[0] : undefined;
  const attached = textNode?.textMode === 'path' && !!textNode.pathTextSettings;

  const patchSettings = useCallback(
    (patch: Partial<NonNullable<TextNode['pathTextSettings']>>) => {
      if (!textNode) return;
      beginTransaction();
      updateNode(textNode.id, (n) => {
        if (n.kind !== 'text' || !n.pathTextSettings) return n;
        return { ...n, pathTextSettings: { ...n.pathTextSettings, ...patch } };
      });
      commitTransaction();
    },
    [textNode, updateNode, beginTransaction, commitTransaction],
  );

  const detach = useCallback(() => {
    if (!textNode) return;
    beginTransaction();
    updateNode(textNode.id, (n) => {
      if (n.kind !== 'text') return n;
      const { pathTextSettings: _dropped, ...rest } = n;
      // Back to a point label: 'area' would re-wrap to a width the text has
      // not had since it was attached.
      return { ...rest, textMode: 'point' } as TextNode;
    });
    commitTransaction();
    announce?.('Text detached from path');
  }, [textNode, updateNode, beginTransaction, commitTransaction, announce]);

  if (!textNode || !attached) return null;

  const settings = textNode.pathTextSettings;
  if (!settings) return null;

  const pathNode = state.document.nodes[settings.pathNodeId];
  const offsetPercent = Math.round((settings.startOffset ?? 0) * 100);

  return (
    <DisclosureSection title="Text on Path" sectionId="text-on-path" defaultExpanded={true}>
      <FieldRow label="Path">
        <span className="insp-hint">{pathNode?.name ?? 'Missing path'}</span>
      </FieldRow>
      <div className="insp-field">
        <label className="insp-field__label" htmlFor="path-text-offset">
          Start
        </label>
        <div className="insp-field__control">
          <div className="insp-slider">
            <input
              type="range"
              id="path-text-offset"
              className="insp-slider__input"
              min={0}
              max={100}
              step={1}
              value={offsetPercent}
              onChange={(e) => patchSettings({ startOffset: Number(e.target.value) / 100 })}
              aria-label="Start offset along path"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={offsetPercent}
            />
            <span className="insp-slider__value">{offsetPercent}%</span>
          </div>
        </div>
      </div>
      <FieldRow label="Side">
        <SegmentedControl
          label="Side of path"
          value={settings.side ?? 'top'}
          options={[
            { value: 'top', label: 'Outside' },
            { value: 'bottom', label: 'Inside' },
          ]}
          onChange={(v) => patchSettings({ side: v as 'top' | 'bottom' })}
        />
      </FieldRow>
      <div className="insp-actions">
        <button type="button" className="insp-btn-sm" onClick={detach}>
          Detach from path
        </button>
      </div>
    </DisclosureSection>
  );
}
