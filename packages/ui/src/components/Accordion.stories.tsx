import type { Meta, StoryObj } from '@storybook/react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './Accordion';

const meta: Meta<typeof Accordion> = {
  title: 'Components/Accordion',
  component: Accordion,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    mode: { control: 'select', options: ['multiple', 'single'] },
    collapsible: { control: 'boolean' },
    variant: { control: 'select', options: ['compact', 'standard'] },
  },
};

export default meta;
type Story = StoryObj<typeof Accordion>;

function AccordionDemo({
  mode = 'multiple',
  collapsible,
  variant = 'standard',
  defaultValue,
}: {
  mode?: 'multiple' | 'single';
  collapsible?: boolean;
  variant?: 'compact' | 'standard';
  defaultValue?: string | string[];
}) {
  return (
    <Accordion
      mode={mode}
      collapsible={collapsible}
      variant={variant}
      defaultValue={defaultValue}
      label="Demo accordion"
    >
      <AccordionItem value="appearance">
        <AccordionTrigger>Appearance</AccordionTrigger>
        <AccordionContent>
          <div style={{ padding: 'var(--space-2) 0', color: 'var(--color-text-secondary)' }}>
            Fill, stroke, and visual effects controls for the selected object.
          </div>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="layout">
        <AccordionTrigger>Layout</AccordionTrigger>
        <AccordionContent>
          <div style={{ padding: 'var(--space-2) 0', color: 'var(--color-text-secondary)' }}>
            Auto layout, constraints, and responsive behavior settings.
          </div>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="export">
        <AccordionTrigger>Export Settings</AccordionTrigger>
        <AccordionContent>
          <div style={{ padding: 'var(--space-2) 0', color: 'var(--color-text-secondary)' }}>
            Format selection, quality, and export preset configuration.
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export const MultipleOpen: Story = {
  render: () => <AccordionDemo defaultValue={['appearance', 'export']} />,
};

export const SingleMode: Story = {
  render: () => <AccordionDemo mode="single" defaultValue="appearance" />,
};

export const SingleCollapsible: Story = {
  render: () => (
    <AccordionDemo mode="single" collapsible defaultValue="layout" />
  ),
};

export const Compact: Story = {
  render: () => <AccordionDemo variant="compact" defaultValue={['appearance']} />,
};

export const WithDisabledItem: Story = {
  render: function DisabledDemo() {
    return (
      <Accordion defaultValue="layout" label="Disabled demo">
        <AccordionItem value="appearance">
          <AccordionTrigger>Appearance</AccordionTrigger>
          <AccordionContent>
            <div style={{ padding: 'var(--space-2) 0', color: 'var(--color-text-secondary)' }}>
              Available controls.
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="layout" disabled>
          <AccordionTrigger>Layout (Unavailable)</AccordionTrigger>
          <AccordionContent>
            <div>This content is unreachable because the item is disabled.</div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  },
};

export const DeeplyNested: Story = {
  render: function NestedDemo() {
    return (
      <Accordion defaultValue="outer" label="Nested demo">
        <AccordionItem value="outer">
          <AccordionTrigger>Outer Section</AccordionTrigger>
          <AccordionContent>
            <Accordion defaultValue="inner" label="Inner accordion">
              <AccordionItem value="inner-a">
                <AccordionTrigger>Nested Item A</AccordionTrigger>
                <AccordionContent>
                  <div style={{ padding: 'var(--space-2) 0', color: 'var(--color-text-secondary)' }}>
                    Inner content with independent state.
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="inner-b">
                <AccordionTrigger>Nested Item B</AccordionTrigger>
                <AccordionContent>
                  <div style={{ padding: 'var(--space-2) 0', color: 'var(--color-text-secondary)' }}>
                    Another inner content panel.
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="second">
          <AccordionTrigger>Second Section</AccordionTrigger>
          <AccordionContent>
            <div style={{ padding: 'var(--space-2) 0', color: 'var(--color-text-secondary)' }}>
              Top-level sibling content.
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  },
};
