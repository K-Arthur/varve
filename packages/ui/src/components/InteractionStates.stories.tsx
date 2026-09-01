import type { Meta, StoryObj } from '@storybook/react';
import './interaction-states.css';

const meta = {
  title: 'Foundations/Interaction states',
  tags: ['autodocs', 'a11y'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const stateSamples = [
  ['Resting', undefined],
  ['Hover me', undefined],
  ['Pressed', 'pressed'],
  ['Selected', 'selected'],
  ['Current', 'current'],
  ['Checked', 'checked'],
  ['Search match', 'search-match'],
  ['Current search match', 'search-current'],
  ['Drop target', 'drop-target'],
  ['Drop denied', 'drop-denied'],
  ['Disabled', 'disabled'],
] as const;

export const Matrix: Story = {
  render: () => (
    <main className="varve-interaction-gallery">
      <fieldset className="varve-interaction-gallery__section">
        <legend className="varve-interaction-gallery__legend">State vocabulary</legend>
        <div className="varve-interaction-gallery__row">
          {stateSamples.map(([label, state]) => (
            <button
              key={label}
              type="button"
              className="varve-interaction-gallery__sample"
              data-state={state}
              aria-pressed={state === 'pressed' || state === 'checked' ? true : undefined}
              disabled={state === 'disabled'}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="varve-interaction-gallery__section">
        <legend className="varve-interaction-gallery__legend">Nested meaning</legend>
        <p>
          Search result with <mark className="varve-interaction-gallery__match">current match</mark>{' '}
          remains readable without relying on color alone.
        </p>
      </fieldset>
    </main>
  ),
};

export const Dark: Story = {
  ...Matrix,
  decorators: [
    (Story) => (
      <div data-theme="dark">
        <Story />
      </div>
    ),
  ],
};

export const HighContrast: Story = {
  ...Matrix,
  decorators: [
    (Story) => (
      <div data-theme="high-contrast">
        <Story />
      </div>
    ),
  ],
};
