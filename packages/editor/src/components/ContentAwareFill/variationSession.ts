/**
 * Keep a bounded candidate history across regeneration without losing the
 * candidate the user was reviewing. New candidates are appended in generation
 * order; when the bound is exceeded, the active pre-regeneration candidate is
 * retained alongside the newest candidates.
 */
export function mergeGenerativeVariations<T extends { id: string }>(
  existing: readonly T[],
  incoming: readonly T[],
  activeId: string | null,
  maximum: number,
): T[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1) return [];

  const byId = new Map<string, T>();
  const order: string[] = [];
  for (const variation of [...existing, ...incoming]) {
    if (!byId.has(variation.id)) order.push(variation.id);
    byId.set(variation.id, variation);
  }

  const ordered = order
    .map((id) => byId.get(id))
    .filter((variation): variation is T => variation !== undefined);
  const recent = ordered.slice(-maximum);
  const active = activeId ? existing.find((variation) => variation.id === activeId) : undefined;
  if (!active || recent.some((variation) => variation.id === active.id) || maximum === 1) {
    return recent;
  }

  return [active, ...ordered.slice(-(maximum - 1))];
}
