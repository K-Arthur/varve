import { Button } from '@varve/ui';
import { useEditor } from '../../context';
import { createPaintLayerForRecovery } from '../../tools/paintLayerRecovery';

/** Visible recovery path after an explicit non-pixel selection refuses paint. */
export function PaintLayerRecoveryAction() {
  const { state, updateDoc, setSelection, announce, groupCompoundOperation } = useEditor();
  const hasExplicitNonRasterSelection = state.selection.some((id) => {
    const node = state.document.nodes[id];
    return Boolean(node && node.kind !== 'rasterLayer');
  });

  if (!hasExplicitNonRasterSelection) return null;

  const createLayer = () => {
    const { document, nodeId } = createPaintLayerForRecovery(state.document, state.workspaceMode);
    groupCompoundOperation('Create paint layer', () => updateDoc(() => document));
    setSelection(nodeId);
    announce('Created Paint Layer. Paint again to start a separate stroke.');
  };

  return (
    <div className="tool-options__recovery">
      <p className="tool-options__hint">
        The selected object is not a pixel layer. Create a separate layer to paint on.
      </p>
      <Button variant="secondary" size="sm" onClick={createLayer}>
        Create paint layer
      </Button>
    </div>
  );
}
