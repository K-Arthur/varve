import type { MenuBuildHelpers, MenuBuildState, MenuItem } from './types';

export function buildHelpMenu(_state: MenuBuildState, helpers: MenuBuildHelpers): MenuItem[] {
  return [
    {
      label: 'Contextual Help',
      shortcut: helpers.fmt('openHelp'),
      ariaKeyshortcut: helpers.ks('openHelp'),
      action: 'openHelp',
    },
    {
      label: 'Help Center',
      shortcut: helpers.fmt('openHelpCenter'),
      ariaKeyshortcut: helpers.ks('openHelpCenter'),
      action: 'openHelpCenter',
    },
    {
      label: "What's This?",
      action: 'whatIsThis',
    },
    { label: '---' },
    { label: 'Take a Tour', action: 'startTour' },
    { label: '---' },
    { label: 'About Strata', action: 'about' },
  ];
}
