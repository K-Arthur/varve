/**
 * Auxiliary window entry point (M6).
 *
 * Loaded by Tauri when creating a new panel window. Reads window identity
 * from URL params, bootstraps a minimal provider tree, and renders the
 * hosted panel(s).
 *
 * Does NOT load: canvas, renderer, models, collaboration, full editor.
 */

import './global.css';
import '@varve/ui/tokens.css';
import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/ibm-plex-sans/index.css';

import { ErrorBoundary } from '@varve/editor';
import { AuxiliaryRoot } from '@varve/editor/auxiliary';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { dismissBootFallback } from './startup/revealMainWindow';

async function bootstrapAuxiliary() {
  dismissBootFallback();

  // Restore persisted theme before first paint
  const savedTheme = localStorage.getItem('varve-theme') ?? localStorage.getItem('strata-theme');
  if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'high-contrast') {
    document.documentElement.dataset.theme = savedTheme;
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('Root element not found');

  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <AuxiliaryRoot />
      </ErrorBoundary>
    </StrictMode>,
  );
}

void bootstrapAuxiliary();
