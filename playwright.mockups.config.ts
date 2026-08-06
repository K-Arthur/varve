import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

// Isolated E2E config for the mockups worktree session: runs against the
// worktree's own vite dev server (port 1421) so concurrent main-tree churn
// cannot affect results.
export default defineConfig({
  ...baseConfig,
  webServer: {
    command: 'pnpm --filter @varve/desktop exec vite --port 1421 --strictPort',
    url: 'http://localhost:1421/',
    reuseExistingServer: true,
    timeout: 120000,
  },
  use: {
    ...baseConfig.use,
    baseURL: 'http://localhost:1421',
  },
});
