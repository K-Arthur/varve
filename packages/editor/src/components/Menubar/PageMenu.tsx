import type { MenuBuildHelpers, MenuBuildState, MenuItem } from './types';

export function buildPageMenu(_state: MenuBuildState, helpers: MenuBuildHelpers): MenuItem[] {
  const doc = _state.document;
  const activePageId = doc?.activePageId ?? null;
  const activePage = activePageId ? doc?.pages?.find((p) => p.id === activePageId) : null;
  const currentPageMasterId = activePage?.masterPageId ?? null;
  const masterNames = doc?.masters
    ? Object.fromEntries(Object.entries(doc.masters).map(([id, m]) => [id, m?.name ?? 'Unknown']))
    : {};
  const currentPageIsMaster = activePageId != null && masterNames[activePageId] != null;

  return [
    ...(currentPageIsMaster
      ? [{ label: 'This page is a master page', disabled: true } as MenuItem]
      : currentPageMasterId
        ? [
            {
              label: `Current Master: ${masterNames[currentPageMasterId] ?? 'Unknown'}`,
              disabled: true,
            } as MenuItem,
          ]
        : [{ label: 'No master applied', disabled: true } as MenuItem]),
    { label: '---' },
    {
      label: 'Create Master',
      action: 'createMaster',
      disabled: helpers.dis('createMaster'),
    },
    { label: '---' },
    ...Object.entries(masterNames)
      .filter(([id]) => id !== activePageId)
      .map(([id, name]) => ({
        label: name,
        action: `applyMaster:${id}`,
      })),
    ...(Object.keys(masterNames).length > 0 ? ([{ label: '---' }] as MenuItem[]) : []),
    {
      label: 'None',
      action: 'applyMaster:',
    },
    { label: '---' },
    {
      label: currentPageMasterId
        ? `Detach from '${masterNames[currentPageMasterId] ?? 'Unknown'}'`
        : 'Detach from Master',
      action: 'detachMaster',
      disabled: helpers.dis('detachMaster'),
    },
  ];
}
