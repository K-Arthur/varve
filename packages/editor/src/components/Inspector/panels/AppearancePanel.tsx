import { canHaveSmartFilters, isImageShape } from '@varve/scene';
import { EmptyState } from '@varve/ui';
import { useEditor } from '../../../context';
import { EffectStudioLauncher } from '../../EffectStudio/EffectStudioLauncher';
import { EffectsSection } from '../sections/EffectsSection';
import { MaskSection } from '../sections/MaskSection';
import { PaintLibrarySection } from '../sections/PaintLibrarySection';
import { PaletteSection } from '../sections/PaletteSection';
import { SmartFiltersSection } from '../sections/SmartFiltersSection';
import './appearancePanel.css';

/**
 * Persistent appearance workflows that need more room than Properties.
 *
 * The full creative gallery intentionally lives in the Effect Studio dialog.
 * This panel keeps only the compact launch point plus the two
 * focused implementation surfaces: raw Object Filters and layer effects.
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
  const studioCompatible = nodes.every(canHaveSmartFilters);

  return (
    <div className="appearance-panel">
      {nodes.length === 1 && <MaskSection nodes={nodes} />}
      <PaintLibrarySection />
      {nodes.length === 1 && isImageShape(nodes[0]!) && <PaletteSection />}
      {studioCompatible && (
        <section className="appearance-panel__effect-launch" aria-label="Creative treatments">
          <div>
            <h2>Creative treatments</h2>
            <p>Browse, apply, and tune curated stacks in the focused Effect Studio dialog.</p>
          </div>
          <EffectStudioLauncher label="Open Studio" />
        </section>
      )}
      {nodes.length === 1 && <SmartFiltersSection nodes={nodes} />}
      {effectsCompatible && <EffectsSection nodes={nodes} />}
    </div>
  );
}
