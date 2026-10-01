/** v2.32 → v2.33 callout-tail outline migration. */
export function migrateV232ToV233(raw: Record<string, unknown>): Record<string, unknown> {
  const sourceNodes = raw.nodes;
  if (!sourceNodes || typeof sourceNodes !== 'object' || Array.isArray(sourceNodes)) {
    return { ...raw, formatVersion: '2.33' };
  }

  const nodes = { ...(sourceNodes as Record<string, unknown>) };
  for (const value of Object.values(nodes)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const group = value as Record<string, unknown>;
    if (group.kind !== 'group' || !group.callout || typeof group.callout !== 'object') continue;
    const callout = group.callout as Record<string, unknown>;
    const tailIds = Array.isArray(callout.tailNodeIds) ? callout.tailNodeIds : [];
    const strokeWeight =
      callout.kind === 'shout'
        ? 4
        : callout.kind === 'burst'
          ? 2.5
          : callout.kind === 'caption' || callout.kind === 'whisper' || callout.kind === 'cloud'
            ? 1.5
            : 2;

    for (const tailId of tailIds) {
      if (typeof tailId !== 'string') continue;
      const tail = nodes[tailId];
      if (!tail || typeof tail !== 'object' || Array.isArray(tail)) continue;
      const path = tail as Record<string, unknown>;
      const points = path.points;
      // v2.32 generated pointed tails used three points in [left, right, tip]
      // order and closed the stroke across the base. Reorder them so the open
      // outline traces only the two sides; the fill still closes implicitly.
      if (
        path.kind !== 'path' ||
        path.closed !== true ||
        !Array.isArray(points) ||
        points.length !== 3 ||
        !points.every((point) => point && typeof point === 'object' && !Array.isArray(point))
      ) {
        continue;
      }

      const [oldLeft, oldRight, tip] = points as Array<Record<string, unknown>>;
      const left = {
        ...oldLeft!,
        y: typeof oldLeft!.y === 'number' ? oldLeft!.y - strokeWeight : oldLeft!.y,
        handleIn: null,
        handleOut: oldLeft!.handleIn ?? null,
      };
      const right = {
        ...oldRight!,
        y: typeof oldRight!.y === 'number' ? oldRight!.y - strokeWeight : oldRight!.y,
        handleIn: oldRight!.handleOut ?? null,
        handleOut: null,
      };
      // The v2.32 curve handles faced into the closed ring. Reverse them to
      // match the new open outline without changing its authored curvature.
      nodes[tailId] = { ...path, closed: false, points: [left, tip, right] };
    }
  }

  return { ...raw, formatVersion: '2.33', nodes };
}
