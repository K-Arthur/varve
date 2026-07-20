import type { Meta, StoryObj } from '@storybook/react';
import { BUILTIN_PRESET_GROUPS } from '@strata/shared';
import { useState } from 'react';
import { PresetPicker } from './PresetPicker';

const meta: Meta<typeof PresetPicker> = {
  title: 'Components/PresetPicker',
  component: PresetPicker,
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj<typeof PresetPicker>;

export const Default: Story = {
  render: () => {
    const [selectedId, setSelectedId] = useState<string>();
    return (
      <div style={{ width: 320 }}>
        <PresetPicker
          groups={BUILTIN_PRESET_GROUPS}
          label="Frame presets"
          selectedId={selectedId}
          onSelect={(preset) => setSelectedId(preset.id)}
        />
      </div>
    );
  },
};

export const WithFavoritesAndRecents: Story = {
  render: () => {
    const [favoriteIds, setFavoriteIds] = useState(new Set(['ig-post', 'a4']));
    return (
      <div style={{ width: 320 }}>
        <PresetPicker
          groups={BUILTIN_PRESET_GROUPS}
          label="Frame presets"
          recentIds={['macbook-pro-16']}
          favoriteIds={favoriteIds}
          onSelect={() => {}}
          onToggleFavorite={(preset) =>
            setFavoriteIds((prev) => {
              const next = new Set(prev);
              if (next.has(preset.id)) next.delete(preset.id);
              else next.add(preset.id);
              return next;
            })
          }
        />
      </div>
    );
  },
};

export const NotSearchable: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <PresetPicker
        groups={BUILTIN_PRESET_GROUPS.slice(0, 1)}
        label="Frame presets"
        onSelect={() => {}}
        searchable={false}
      />
    </div>
  ),
};
