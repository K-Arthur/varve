/**
 * Panel Layouts — divide or join ordinary clipped frames as comic panels.
 *
 * Mounted while the Panel tool is active: choosing a template divides a frame
 * into rows x columns with one constant gutter (the CLIP STUDIO PAINT
 * "Divide frame border equally" equivalent), while Join preserves child
 * artwork and its world transforms.
 * Panels are FrameNodes under panel conventions — the same object model as
 * frames and export regions, never a parallel node type (ADR-0238).
 */
import { Button } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';
import { useEditor } from '../../../context';
import { PANEL_LAYOUT_PRESETS, previewPanelDivision } from '../../../scene/panelLayout';
import { DisclosureSection } from '../controls/DisclosureSection';
import type { SectionId } from '../sectionRegistry';

interface PendingDivision {
  presetId: string;
  label: string;
  destinationCount: number;
  sourceChildCount: number;
  estimatedAdditionalRasterBytes: number;
}

export function PanelLayoutsSection({ sectionId }: { sectionId?: SectionId }) {
  const { applyPanelLayout, joinPanels, state } = useEditor();
  const [pending, setPending] = useState<PendingDivision | null>(null);
  const selectedFrame =
    state.selection.length === 1 ? state.document.nodes[state.selection[0]!] : undefined;
  const canDivide = selectedFrame?.kind === 'frame';
  const selectedPanels = state.selection.filter((id) => docPanel(state.document, id));

  // A pending confirmation belongs to the selection that produced it: a new
  // selection invalidates the cost estimate, so it is dismissed rather than
  // applied to different artwork.
  const selectionKey = state.selection.join(',');
  useEffect(() => {
    setPending(null);
  }, [selectionKey]);

  const handleSelect = useCallback(
    (presetId: string) => {
      const preview = previewPanelDivision(state.document, state.selection, presetId);
      if (!preview) return;
      if (preview.estimatedAdditionalRasterBytes > 0) {
        setPending({
          label: PANEL_LAYOUT_PRESETS.find((preset) => preset.id === presetId)?.label ?? 'Layout',
          ...preview,
        });
        return;
      }
      applyPanelLayout(presetId);
    },
    [applyPanelLayout, state.document, state.selection],
  );

  const confirmPending = useCallback(() => {
    if (!pending) return;
    applyPanelLayout(pending.presetId);
    setPending(null);
  }, [applyPanelLayout, pending]);

  return (
    <DisclosureSection title="Panel Layouts" sectionId={sectionId}>
      <p className="insp-hint">
        Panel layouts set boundaries, gutters, and reading rhythm. Page and strip sizes live in
        Frame or New Document presets.
      </p>
      <Button variant="ghost" size="sm" onClick={joinPanels} disabled={selectedPanels.length < 2}>
        Join selected panels
      </Button>
      {PANEL_LAYOUT_PRESETS.map((preset) => (
        <Button
          key={preset.id}
          variant="ghost"
          size="sm"
          title={preset.description}
          onClick={() => handleSelect(preset.id)}
          disabled={!canDivide}
        >
          {preset.label}
        </Button>
      ))}
      {pending && (
        <div className="insp-hint" role="alert">
          <strong>{pending.label}</strong>: {pending.destinationCount} panels will receive
          independent copies of {pending.sourceChildCount} source layer
          {pending.sourceChildCount === 1 ? '' : 's'}. Estimated additional raster allocation:{' '}
          {formatBytes(pending.estimatedAdditionalRasterBytes)}.
          <div className="insp-actions">
            <Button variant="default" size="sm" onClick={confirmPending}>
              Divide anyway
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </DisclosureSection>
  );
}

function docPanel(document: Parameters<typeof previewPanelDivision>[0], id: string): boolean {
  const node = document.nodes[id];
  return node?.kind === 'frame' && Boolean(node.panel);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
