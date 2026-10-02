import type { Page } from '@playwright/test';

/** Built-in side-panel boundaries, with the grid fallback for compact hosts. */
export function panelResizeHandle(page: Page, side: 'layers' | 'inspector') {
  const split = side === 'layers' ? 'layers-main' : 'center-inspector';
  return page
    .getByTestId(`dock-splitter-${split}`)
    .or(page.getByRole('separator', { name: `Resize ${side} panel`, exact: true }));
}

export async function resizePanelTo(
  page: Page,
  side: 'layers' | 'inspector',
  bound: 'minimum' | 'expanded',
) {
  const handle = panelResizeHandle(page, side);
  await handle.focus();
  const docked = (await handle.getAttribute('data-testid'))?.startsWith('dock-splitter-');
  // A dock ratio sizes its FIRST child. Inspector is the second child,
  // whereas the grid fallback directly sizes the named panel in pixels.
  const minimumKey = side === 'inspector' && docked ? 'End' : 'Home';
  await handle.press(bound === 'minimum' ? minimumKey : minimumKey === 'Home' ? 'End' : 'Home');
}
