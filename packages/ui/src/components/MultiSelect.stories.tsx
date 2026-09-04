import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'storybook/preview-api';
import { MultiSelect } from './MultiSelect';

const options = [
  { value: 'png', label: 'PNG' },
  { value: 'svg', label: 'SVG' },
  { value: 'pdf', label: 'PDF' },
  { value: 'webp', label: 'WebP' },
];

const meta: Meta<typeof MultiSelect> = {
  title: 'Components/MultiSelect',
  component: MultiSelect,
  tags: ['autodocs', 'a11y'],
  argTypes: {
    searchable: { control: 'boolean' },
    disabled: { control: 'boolean' },
    maxSelected: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof MultiSelect>;

export const Default: Story = {
  render: () => {
    const [values, setValues] = useState<string[]>(['png']);
    return (
      <MultiSelect
        label="Export targets"
        values={values}
        onValuesChange={setValues}
        options={options}
      />
    );
  },
};

export const SearchableGrouped: Story = {
  render: () => {
    const [values, setValues] = useState<string[]>([]);
    return (
      <MultiSelect
        label="Analysis checks"
        values={values}
        onValuesChange={setValues}
        searchable
        groups={[
          {
            label: 'Output',
            options: Array.from({ length: 12 }, (_, index) => ({
              value: `check-${index}`,
              label: `Check ${index + 1}`,
            })),
          },
        ]}
      />
    );
  },
};

export const SelectionLimit: Story = {
  render: () => {
    const [values, setValues] = useState<string[]>(['png']);
    return (
      <MultiSelect
        label="Primary output"
        values={values}
        onValuesChange={setValues}
        options={options}
        maxSelected={1}
      />
    );
  },
};
