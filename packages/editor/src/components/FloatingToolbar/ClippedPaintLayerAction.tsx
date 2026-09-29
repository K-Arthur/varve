import { Button } from '@varve/ui';
import { useEditor } from '../../context';
import { createClippedPaintLayer } from '../../tools/clippedPaintLayer';

/** Add a paint layer that keeps its alpha inside the selected raster source. */
export function ClippedPaintLayerAction() {
  const { state, getWorldTransform, updateDoc, setSelection, announce, groupCompoundOperation } =
    useEditor();
  const selectedId = state.selection.length === 1 ? state.selection[0] : undefined;
  const source = selectedId ? state.document.nodes[selectedId] : undefined;
  if (source?.kind !== 'rasterLayer') return null;

  const createLayer = () => {
    const result = createClippedPaintLayer(
      state.document,
      state.workspaceMode,
      source.id,
      getWorldTransform,
    );
    if (!result.ok) {
      announce(result.reason);
      return;
    }
    groupCompoundOperation('Create clipped paint layer', () => updateDoc(() => result.document));
    setSelection(result.layerId);
    announce(
      `Created clipped Shading layer for ${source.name}. Paint to add color inside its alpha.`,
    );
  };

  return (
    <div className="tool-options__recovery" data-testid="clipped-paint-layer-action">
      <p className="tool-options__hint">
        Keep a separate shading layer inside this raster layer’s alpha.
      </p>
      <Button variant="secondary" size="sm" onClick={createLayer}>
        Create clipped paint layer
      </Button>
    </div>
  );
}
