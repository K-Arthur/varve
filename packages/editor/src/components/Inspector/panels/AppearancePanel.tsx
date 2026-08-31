import { isImageShape } from '@varve/scene';
import { EmptyState } from '@varve/ui';
import { useEditor } from '../../../context';
import { EffectsSection } from '../sections/EffectsSection';
import { MaskSection } from '../sections/MaskSection';
import { PaintLibrarySection } from '../sections/PaintLibrarySection';
import { PaletteSection } from '../sections/PaletteSection';
import { SmartFiltersSection } from '../sections/SmartFiltersSection';
import './appearancePanel.css';

/**
 * Persistent appearance workflows, merged into the Design tab.
 *
 * The full creative gallery intentionally lives in the Effect Studio dialog —
 * its launch point lives in the AppearanceSection registry section, so this
 * surface hosts only the focused implementation surfaces: raw Object Filters,
 * layer effects, masks, shared paints, and image palettes.
 */
export function AppearancePanel() {
  const { selectedNodes } = useEditor();
  const nodes = selectedNodes();

  if (nodes.length === 0) {
    return (
      <EmptyState
        illustration={<span aria-hidden />}
        headline="No appearance selected"
        description="Select an object to edit masks, shared paints, and effect stacks."
      />
    );
  }

  const effectsCompatible = nodes.every((node) =>
    ['shape', 'text', 'frame', 'adjustment', 'path'].includes(node.kind),
  );

  return (
    <div className="appearance-panel">
      {nodes.length === 1 && <MaskSection nodes={nodes} />}
      <PaintLibrarySection />
      {nodes.length === 1 && isImageShape(nodes[0]!) && <PaletteSection />}
      {nodes.length === 1 && <SmartFiltersSection nodes={nodes} />}
      {effectsCompatible && <EffectsSection nodes={nodes} />}
    </div>
  );
}
