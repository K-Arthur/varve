import './global.css';
import '@strata/ui/tokens.css';
import '@strata/editor/editor.css';
import '@strata/home/home.css';
import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/ibm-plex-sans/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Restore persisted theme before first paint so both home and editor surfaces
// start with the correct [data-theme] attribute rather than falling through to
// the OS prefers-color-scheme default.
const savedTheme = localStorage.getItem('strata-theme');
if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'high-contrast') {
  document.documentElement.dataset.theme = savedTheme;
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
