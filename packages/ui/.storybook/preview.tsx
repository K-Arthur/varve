import type { Preview } from '@storybook/react';

import '@varve/ui/tokens.css';
import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/ibm-plex-sans/index.css';

const preview: Preview = {
  decorators: [
    (Story) => (
      <div style={{ background: 'var(--color-surface-base)', padding: '24px', minHeight: '100vh' }}>
        <Story />
      </div>
    ),
  ],
  tags: ['autodocs'],
};

export default preview;
