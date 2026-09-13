import type { Fill, GenerativeEditRecord } from '@varve/scene';

/**
 * Remap the provenance marker on bounded generative image fills after an
 * imported subtree has been assigned new document-level edit IDs.
 *
 * The patch bytes remain valid even when their recipe is not transported, so
 * an unresolved marker is removed rather than leaving Restore Original or
 * repeated-edit cleanup pointing at another document's record.
 */
export function remapGenerativeEditOverlays(
  fills: readonly Fill[] | undefined,
  generativeIdMap: ReadonlyMap<string, string>,
  generativeEdits: Readonly<Record<string, GenerativeEditRecord>>,
): Fill[] | undefined {
  if (!fills) return fills;

  return fills.map((fill) => {
    if (fill.type !== 'image' || !fill.image) return fill;
    const overlay = fill.image.generativeEditOverlay;
    if (!overlay) return fill;

    const mappedEditId = generativeIdMap.get(overlay.editId);
    const edit = mappedEditId ? generativeEdits[mappedEditId] : undefined;
    if (
      !mappedEditId ||
      !edit?.variations.some((variation) => variation.id === overlay.variationId)
    ) {
      const { generativeEditOverlay: _overlay, ...image } = fill.image;
      return { ...fill, image };
    }

    return {
      ...fill,
      image: {
        ...fill.image,
        generativeEditOverlay: {
          ...overlay,
          editId: mappedEditId,
        },
      },
    };
  });
}

/** Remap repeated-edit lineage after every imported edit has an allocated ID. */
export function remapGenerativeEditLineage(
  generativeEdits: Record<string, GenerativeEditRecord>,
  generativeIdMap: ReadonlyMap<string, string>,
): void {
  for (const sourceEditId of generativeIdMap.keys()) {
    const editId = generativeIdMap.get(sourceEditId);
    const edit = editId ? generativeEdits[editId] : undefined;
    if (!edit || edit.parentEditId === undefined) continue;

    const parentEditId = generativeIdMap.get(edit.parentEditId);
    if (parentEditId && generativeEdits[parentEditId]) {
      generativeEdits[editId] = { ...edit, parentEditId };
      continue;
    }

    const { parentEditId: _parentEditId, ...withoutParent } = edit;
    generativeEdits[editId] = withoutParent;
  }
}
