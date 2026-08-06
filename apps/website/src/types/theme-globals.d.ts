/**
 * Global theme API installed by the pre-paint inline script in Layout.astro
 * (head). The bundled body script wires the theme switcher to it.
 */
interface VarveThemeApi {
  read: () => string | null;
  write: (value: string) => void;
  resolve: (choice: string | null) => string;
  apply: () => void;
}

interface Window {
  __varveTheme?: VarveThemeApi;
}
