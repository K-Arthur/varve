import { getActionRegistry } from '../actions/ActionRegistry';
import type { LayoutPreference } from '../settings';
import { LAYOUT_PREFERENCE_REQUEST_EVENT } from './layoutPresentation';

const CHOICES: ReadonlyArray<readonly [LayoutPreference, string]> = [
  ['auto', 'Automatic workspace layout'],
  ['tablet', 'Tablet workspace layout'],
  ['desktop', 'Desktop workspace layout'],
];

/** Register View-menu commands without coupling the menu hub to Settings UI. */
export function registerLayoutPreferenceCommands(): void {
  const registry = getActionRegistry();
  for (const [preference, label] of CHOICES) {
    const id = `layoutPreference:${preference}`;
    const handler = () => {
      if (typeof window === 'undefined') return;
      window.dispatchEvent(
        new CustomEvent(LAYOUT_PREFERENCE_REQUEST_EVENT, { detail: { preference } }),
      );
    };
    if (registry.has(id)) registry.updateHandler(id, handler, { placeholder: false });
    else registry.register({ id, label, category: 'view' }, handler);
  }
}
