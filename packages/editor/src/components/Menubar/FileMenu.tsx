import type { MenuBuildHelpers, MenuBuildState, MenuItem, RecentEntry } from './types';

export function buildFileMenu(
  state: MenuBuildState,
  recentEntries: RecentEntry[],
  helpers: MenuBuildHelpers,
): MenuItem[] {
  const items: MenuItem[] = [
    {
      label: 'New',
      shortcut: helpers.fmt('newDocument'),
      ariaKeyshortcut: helpers.ks('newDocument'),
      action: 'new',
    },
    {
      label: 'Open\u2026',
      shortcut: helpers.fmt('open'),
      ariaKeyshortcut: helpers.ks('open'),
      action: 'open',
    },
    {
      label: 'Save',
      shortcut: helpers.fmt('save'),
      ariaKeyshortcut: helpers.ks('save'),
      action: 'save',
    },
    {
      label: 'Save As\u2026',
      shortcut: helpers.fmt('saveAs'),
      ariaKeyshortcut: helpers.ks('saveAs'),
      action: 'saveAs',
    },
    { label: '---' },
    ...(recentEntries.length > 0
      ? [
          {
            label: 'Open Recent',
            disabled: true,
            action: '',
          } as MenuItem,
          ...recentEntries.slice(0, 10).map(
            (e) =>
              ({
                label: e.label,
                action: `recent:${e.id}`,
              }) as MenuItem,
          ),
          {
            label: 'Clear Recent Files',
            action: 'clearRecent',
          } as MenuItem,
          { label: '---' },
        ]
      : []),
    {
      label: 'Import\u2026',
      shortcut: helpers.fmt('import'),
      ariaKeyshortcut: helpers.ks('import'),
      action: 'import',
    },
    {
      label: 'Export SVG\u2026',
      shortcut: helpers.fmt('exportSvg'),
      ariaKeyshortcut: helpers.ks('exportSvg'),
      action: 'exportSvg',
    },
    {
      label: 'Export\u2026',
      shortcut: helpers.fmt('export'),
      ariaKeyshortcut: helpers.ks('export'),
      action: 'export',
    },
    { label: '---' },
    {
      label: 'Backup Archive\u2026',
      shortcut: helpers.fmt('archiveBackup'),
      ariaKeyshortcut: helpers.ks('archiveBackup'),
      action: 'archiveBackup',
    },
    {
      label: 'Restore Archive\u2026',
      shortcut: helpers.fmt('archiveRestore'),
      ariaKeyshortcut: helpers.ks('archiveRestore'),
      action: 'archiveRestore',
    },
    { label: '---' },
    {
      label: 'Present\u2026',
      shortcut: helpers.fmt('present'),
      ariaKeyshortcut: helpers.ks('present'),
      action: 'present',
    },
    { label: '---' },
    {
      label: 'Settings\u2026',
      shortcut: helpers.fmt('settings'),
      ariaKeyshortcut: helpers.ks('settings'),
      action: 'settings',
    },
  ];

  return items;
}
