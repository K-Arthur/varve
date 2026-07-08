import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [react(), tailwind()],
  site: 'https://strata.design',
  base: '/',
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
});
