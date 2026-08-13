import { isImageShape } from '@varve/scene';
import { EmptyState } from '@varve/ui';
import { useEditor } from '../../../context';
import { EffectsSection } from '../sections/EffectsSection';
import { MaskSection } from '../sections/MaskSection';
import { PaintLibrarySection } from '../sections/PaintLibrarySection';
import { PaletteSection } from '../sections/PaletteSection';

/** Full, persistent appearance workflows that need more room than Properties. */
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
    <>
      {nodes.length === 1 && <MaskSection nodes={nodes} />}
      <PaintLibrarySection />
      {nodes.length === 1 && isImageShape(nodes[0]!) && <PaletteSection />}
      {effectsCompatible && <EffectsSection nodes={nodes} />}
    </>
  );
}
