/**
 * useTabletLayout — whether the editor is currently presenting its tablet
 * layout.
 *
 * `Shell`'s layout-presentation controller publishes the resolved mode on
 * `document.documentElement[data-layout-mode]` (see `settings/layoutPresentation.ts`)
 * and CSS keys off the same attribute, so this hook is the DOM contract rather
 * than a second derivation of the same rules.
 *
 * The palette uses it to decide whether its trailing control cluster has any
 * content at all. `TabletTouchControls` is the only unconditional child of that
 * cluster, so without this the cluster rendered as an empty ~11x10px box with a
 * `border-left` — a stray divider at the palette's trailing edge on every
 * desktop session (see docs/architecture/toolbar-system.md).
 */
import { useEffect, useState } from 'react';

const TABLET_LAYOUT_ATTRIBUTE = 'data-layout-mode';

function readTabletLayout(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.layoutMode === 'tablet';
}

export function useTabletLayout(): boolean {
  const [tablet, setTablet] = useState(readTabletLayout);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const root = document.documentElement;
    const update = () => setTablet(readTabletLayout());
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: [TABLET_LAYOUT_ATTRIBUTE],
    });
    return () => observer.disconnect();
  }, []);

  return tablet;
}
