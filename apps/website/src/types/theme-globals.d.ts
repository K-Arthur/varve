/**
 * Global theme API installed by the pre-paint inline script in Layout.astro
 * (head). The bundled ThemeToggle script wires the switcher to it.
 *
 * The site exposes exactly two themes (light/dark). state() reports the
 * resolved theme plus whether it came from an explicit persisted choice —
 * first-time visitors follow the OS until they click.
 */
interface VarveThemeApi {
  read: () => string | null;
  /** Persist an explicit choice. Legacy/invalid values migrate to the OS
   *  resolution rather than being stored verbatim. */
  write: (value: string) => void;
  /** Resolve the effective theme (explicit choice, else OS). */
  resolve: () => string;
  /** Re-apply the resolved theme to <html data-theme>. */
  apply: () => void;
  state: () => { theme: 'light' | 'dark'; explicit: boolean };
}

interface Window {
  __varveTheme?: VarveThemeApi;
}
