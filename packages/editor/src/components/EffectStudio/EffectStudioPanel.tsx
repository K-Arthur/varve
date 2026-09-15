/**
 * Dialog content for curated creative treatments.
 *
 * It reads the live editor selection, so changing selection while the dialog
 * is open retargets the treatment controls without copying document state.
 */
import { canHaveSmartFilters } from '@varve/scene';
import { EmptyState } from '@varve/ui';
import { useEditor } from '../../context';
import { EffectStudioSection } from '../Inspector/sections/EffectStudioSection';

export function EffectStudioPanel() {
  const { selectedNodes } = useEditor();
  const nodes = selectedNodes();

  if (nodes.length === 0) {
    return (
      <EmptyState
        illustration={<span aria-hidden />}
        headline="Select an object"
        description="Select a raster or vector object in the main window to browse and tune creative treatments."
      />
    );
  }

  if (!nodes.every(canHaveSmartFilters)) {
    return (
      <EmptyState
        illustration={<span aria-hidden />}
        headline="Treatments are unavailable for this selection"
        description="Select a raster or vector object that can carry an editable effect stack."
      />
    );
  }

  return (
    <div className="effect-studio-panel" data-effect-studio-panel>
      <EffectStudioSection nodes={nodes} presentation="dialog" />
    </div>
  );
}
