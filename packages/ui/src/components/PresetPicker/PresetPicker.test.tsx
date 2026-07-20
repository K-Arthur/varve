/** @vitest-environment jsdom */

import type { CustomPreset, PresetGroup } from '@strata/shared';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresetPicker } from './PresetPicker';

afterEach(cleanup);

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

const socialGroup: PresetGroup = {
  category: 'social',
  label: 'Social',
  presets: [
    {
      id: 'ig-post',
      name: 'Instagram Post',
      category: 'social',
      width: 1080,
      height: 1080,
      unit: 'px',
      orientation: 'square',
      tags: ['instagram'],
    },
    {
      id: 'ig-story',
      name: 'Instagram Story',
      category: 'social',
      width: 1080,
      height: 1920,
      unit: 'px',
      orientation: 'portrait',
      tags: ['instagram'],
    },
  ],
};

const paperGroup: PresetGroup = {
  category: 'paper',
  label: 'Paper',
  presets: [
    {
      id: 'a4',
      name: 'A4',
      category: 'paper',
      width: 210,
      height: 297,
      unit: 'mm',
      orientation: 'portrait',
    },
  ],
};

const groups: PresetGroup[] = [socialGroup, paperGroup];

const customPreset: CustomPreset = {
  id: 'custom-1',
  name: 'My Card',
  category: 'custom',
  width: 100,
  height: 50,
  unit: 'px',
  orientation: 'landscape',
  createdAt: 1,
  updatedAt: 1,
};

describe('PresetPicker', () => {
  it('renders every group label and preset tile', () => {
    render(<PresetPicker groups={groups} label="Presets" onSelect={vi.fn()} />);
    expect(screen.getByText('Social')).toBeInTheDocument();
    expect(screen.getByText('Paper')).toBeInTheDocument();
    expect(screen.getByText('Instagram Post')).toBeInTheDocument();
    expect(screen.getByText('Instagram Story')).toBeInTheDocument();
    expect(screen.getByText('A4')).toBeInTheDocument();
  });

  it('calls onSelect with the right preset on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PresetPicker groups={groups} label="Presets" onSelect={onSelect} />);
    await user.click(screen.getByText('A4'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a4' }));
  });

  it('filters presets by name via search', async () => {
    const user = userEvent.setup();
    render(<PresetPicker groups={groups} label="Presets" onSelect={vi.fn()} />);
    await user.type(screen.getByRole('combobox'), 'A4');
    expect(screen.getByText('A4')).toBeInTheDocument();
    expect(screen.queryByText('Instagram Post')).not.toBeInTheDocument();
    expect(screen.queryByText('Social')).not.toBeInTheDocument();
  });

  it('filters presets by tag', async () => {
    const user = userEvent.setup();
    render(<PresetPicker groups={groups} label="Presets" onSelect={vi.fn()} />);
    await user.type(screen.getByRole('combobox'), 'instagram');
    expect(screen.getByText('Instagram Post')).toBeInTheDocument();
    expect(screen.getByText('Instagram Story')).toBeInTheDocument();
    expect(screen.queryByText('A4')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    render(<PresetPicker groups={groups} label="Presets" onSelect={vi.fn()} />);
    await user.type(screen.getByRole('combobox'), 'zzz-no-match');
    expect(screen.getByText(/no presets match/i)).toBeInTheDocument();
  });

  it('navigates with ArrowDown/ArrowUp, skipping header rows, and selects with Enter', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PresetPicker groups={groups} label="Presets" onSelect={onSelect} />);
    const combobox = screen.getByRole('combobox');
    combobox.focus();
    // First preset (Instagram Post) is highlighted by default; move to the next.
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'ig-story' }));
  });

  it('Home/End jump to the first/last preset row', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PresetPicker groups={groups} label="Presets" onSelect={onSelect} />);
    const combobox = screen.getByRole('combobox');
    combobox.focus();
    await user.keyboard('{End}');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a4' }));
    onSelect.mockClear();
    await user.keyboard('{Home}');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'ig-post' }));
  });

  it('Escape clears an active search query', async () => {
    const user = userEvent.setup();
    render(<PresetPicker groups={groups} label="Presets" onSelect={vi.fn()} />);
    const combobox = screen.getByRole('combobox');
    await user.type(combobox, 'A4');
    expect(combobox).toHaveValue('A4');
    await user.keyboard('{Escape}');
    expect(combobox).toHaveValue('');
  });

  it('renders a pinned Favorites section and toggles favorite without triggering selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onToggleFavorite = vi.fn();
    render(
      <PresetPicker
        groups={groups}
        label="Presets"
        onSelect={onSelect}
        favoriteIds={new Set(['a4'])}
        onToggleFavorite={onToggleFavorite}
      />,
    );
    expect(screen.getByText('Favorites')).toBeInTheDocument();
    // A4 is intentionally rendered twice — once pinned under Favorites, once
    // in its normal Paper group — so both copies' stars exist; either fires
    // the same callback for the same preset.
    const [star] = screen.getAllByRole('button', { name: /remove a4 from favorites/i });
    await user.click(star as HTMLElement);
    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ id: 'a4' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders a pinned Recent section', () => {
    render(
      <PresetPicker groups={groups} label="Presets" onSelect={vi.fn()} recentIds={['ig-post']} />,
    );
    expect(screen.getByText('Recent')).toBeInTheDocument();
  });

  it('renders a Custom section for user-created presets', () => {
    render(
      <PresetPicker
        groups={groups}
        label="Presets"
        onSelect={vi.fn()}
        customPresets={[customPreset]}
      />,
    );
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByText('My Card')).toBeInTheDocument();
  });

  it('shows an overflow menu with edit/duplicate/delete only for custom presets', () => {
    render(
      <PresetPicker
        groups={groups}
        label="Presets"
        onSelect={vi.fn()}
        customPresets={[customPreset]}
        onEditCustom={vi.fn()}
        onDuplicateCustom={vi.fn()}
        onDeleteCustom={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /more actions for my card/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more actions for a4/i })).not.toBeInTheDocument();
  });

  it('fires onDeleteCustom from the overflow menu without triggering onSelect', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onDeleteCustom = vi.fn();
    render(
      <PresetPicker
        groups={groups}
        label="Presets"
        onSelect={onSelect}
        customPresets={[customPreset]}
        onDeleteCustom={onDeleteCustom}
      />,
    );
    await user.click(screen.getByRole('button', { name: /more actions for my card/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(onDeleteCustom).toHaveBeenCalledWith(expect.objectContaining({ id: 'custom-1' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('hides the search field when searchable is false', () => {
    render(<PresetPicker groups={groups} label="Presets" onSelect={vi.fn()} searchable={false} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

describe('PresetPicker without onToggleFavorite/custom callbacks', () => {
  it('renders plainly with no favorite star or overflow menu', () => {
    render(
      <PresetPicker
        groups={groups}
        label="Presets"
        onSelect={vi.fn()}
        customPresets={[customPreset]}
      />,
    );
    expect(screen.queryByRole('button', { name: /favorites/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument();
  });
});
