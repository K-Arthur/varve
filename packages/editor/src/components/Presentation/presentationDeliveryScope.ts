import type { PresentationDeckResolution, ResolvedPresentationSlide } from '@varve/scene';

export interface PresentationDeliveryScope {
  selectedScope: boolean;
  slides: ResolvedPresentationSlide[];
  deliveryErrors: ResolvedPresentationSlide[];
}

/** Selects included slides in deck order and keeps missing selected refs as blockers. */
export function resolvePresentationDeliveryScope(
  resolution: PresentationDeckResolution,
  selectedEntryIds?: string[],
): PresentationDeliveryScope {
  if (selectedEntryIds === undefined) {
    return {
      selectedScope: false,
      slides: resolution.includedSlides,
      deliveryErrors: resolution.deliveryErrors,
    };
  }
  const selected = new Set(selectedEntryIds);
  return {
    selectedScope: true,
    slides: resolution.includedSlides.filter(({ entry }) => selected.has(entry.id)),
    deliveryErrors: resolution.deliveryErrors.filter(({ entry }) => selected.has(entry.id)),
  };
}
