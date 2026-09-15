/** v2.24 → v2.25 migration: version the generative-edit provenance contract. */
export function migrateV224ToV225(raw: Record<string, unknown>): Record<string, unknown> {
  const source = raw.generativeEdits;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { ...raw, formatVersion: '2.25' };
  }

  const generativeEdits: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(source as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const edit = value as Record<string, unknown>;
    if (edit.schemaVersion !== 1 || typeof edit.maskAssetId !== 'string') {
      generativeEdits[id] = value;
      continue;
    }

    const width = Number.isSafeInteger(edit.maskWidth) ? (edit.maskWidth as number) : 1;
    const height = Number.isSafeInteger(edit.maskHeight) ? (edit.maskHeight as number) : 1;
    const firstVariation = Array.isArray(edit.variations)
      ? (edit.variations[0] as Record<string, unknown> | undefined)
      : undefined;
    const outputWidth =
      firstVariation && Number.isSafeInteger(firstVariation.width)
        ? (firstVariation.width as number)
        : width;
    const outputHeight =
      firstVariation && Number.isSafeInteger(firstVariation.height)
        ? (firstVariation.height as number)
        : height;
    const outputFrame = {
      x: 0,
      y: 0,
      width: Math.max(1, outputWidth),
      height: Math.max(1, outputHeight),
      sourceWidth: Math.max(1, width),
      sourceHeight: Math.max(1, height),
      coordinateSpace: 'source-image-pixels',
    };

    generativeEdits[id] = {
      ...edit,
      schemaVersion: 2,
      ...(typeof edit.sourceAssetId === 'string'
        ? { sourceSnapshotAssetId: edit.sourceAssetId }
        : {}),
      masks: {
        userMaskAssetId: edit.maskAssetId,
        width: Math.max(1, width),
        height: Math.max(1, height),
        offsetX: 0,
        offsetY: 0,
        coordinateSpace: 'source-image-pixels',
      },
      outputFrame,
    };
  }

  return {
    ...raw,
    formatVersion: '2.25',
    generativeEdits: Object.keys(generativeEdits).length > 0 ? generativeEdits : undefined,
  };
}
