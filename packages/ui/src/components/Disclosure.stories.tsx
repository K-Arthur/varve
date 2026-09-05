import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Disclosure, DisclosureContent, DisclosureTrigger } from './Disclosure';

const meta: Meta<typeof Disclosure> = {
  title: 'Components/Disclosure',
  component: Disclosure,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    variant: { control: 'select', options: ['compact', 'standard'] },
    open: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Disclosure>;

export const Default: Story = {
  args: {
    variant: 'standard',
    children: (
      <>
        <DisclosureTrigger>Section Title</DisclosureTrigger>
        <DisclosureContent>
          <div style={{ padding: 'var(--space-2) 0', color: 'var(--color-text-secondary)' }}>
            This is the collapsible content. It respects all Varve design tokens for spacing,
            typography, and color.
          </div>
        </DisclosureContent>
      </>
    ),
  },
};

export const Compact: Story = {
  args: {
    variant: 'compact',
    children: (
      <>
        <DisclosureTrigger>Compact Section</DisclosureTrigger>
        <DisclosureContent>
          <div style={{ padding: 'var(--space-1) 0', color: 'var(--color-text-secondary)' }}>
            Compact variant for dense sidebar layouts where vertical space is scarce.
          </div>
        </DisclosureContent>
      </>
    ),
  },
};

export const DefaultOpen: Story = {
  args: {
    defaultOpen: true,
    children: (
      <>
        <DisclosureTrigger>Expanded Section</DisclosureTrigger>
        <DisclosureContent>
          <div style={{ padding: 'var(--space-2) 0', color: 'var(--color-text-secondary)' }}>
            This section starts expanded.
          </div>
        </DisclosureContent>
      </>
    ),
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    children: (
      <>
        <DisclosureTrigger>Disabled Section</DisclosureTrigger>
        <DisclosureContent>
          <div>This content is unreachable.</div>
        </DisclosureContent>
      </>
    ),
  },
};

export const Controlled: Story = {
  render: function ControlledExample() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <Disclosure open={open} onOpenChange={setOpen}>
          <DisclosureTrigger>Controlled Section</DisclosureTrigger>
          <DisclosureContent>
            <div style={{ padding: 'var(--space-2) 0', color: 'var(--color-text-secondary)' }}>
              State is managed externally. Toggle via the trigger or the button below.
            </div>
          </DisclosureContent>
        </Disclosure>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            marginTop: 'var(--space-2)',
            padding: 'var(--space-1) var(--space-2)',
            background: 'var(--color-surface-raised)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-control)',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
          }}
        >
          Toggle externally ({open ? 'close' : 'open'})
        </button>
      </div>
    );
  },
};

export const WithKeepMounted: Story = {
  args: {
    keepMounted: true,
    children: (
      <>
        <DisclosureTrigger>Keep Mounted Section</DisclosureTrigger>
        <DisclosureContent>
          <div style={{ padding: 'var(--space-2) 0', color: 'var(--color-text-secondary)' }}>
            This content stays in the DOM when closed (hidden via the hidden attribute). Useful for
            preserving form state or expensive components.
          </div>
        </DisclosureContent>
      </>
    ),
  },
};

export const MultipleStacked: Story = {
  render: function StackedExample() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Disclosure variant="compact" defaultOpen>
          <DisclosureTrigger>Appearance</DisclosureTrigger>
          <DisclosureContent>
            <div style={{ padding: 'var(--space-1) 0', color: 'var(--color-text-secondary)' }}>
              Fill, stroke, effects controls.
            </div>
          </DisclosureContent>
        </Disclosure>
        <Disclosure variant="compact">
          <DisclosureTrigger>Layout</DisclosureTrigger>
          <DisclosureContent>
            <div style={{ padding: 'var(--space-1) 0', color: 'var(--color-text-secondary)' }}>
              Auto layout controls.
            </div>
          </DisclosureContent>
        </Disclosure>
        <Disclosure variant="compact">
          <DisclosureTrigger>Export Settings</DisclosureTrigger>
          <DisclosureContent>
            <div style={{ padding: 'var(--space-1) 0', color: 'var(--color-text-secondary)' }}>
              Format, quality, and size options.
            </div>
          </DisclosureContent>
        </Disclosure>
      </div>
    );
  },
};
