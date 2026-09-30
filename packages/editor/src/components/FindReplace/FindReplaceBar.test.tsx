import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FIND_REPLACE_STATE } from '../../findReplace/types';
import type { FindReplaceAPI } from '../../findReplace/useFindReplace';
import { FindReplaceBar } from './FindReplaceBar';

afterEach(cleanup);

function makeApi(): FindReplaceAPI {
  return {
    state: {
      ...DEFAULT_FIND_REPLACE_STATE,
      open: true,
    },
    setSearchText: vi.fn(),
    setReplaceText: vi.fn(),
    setOption: vi.fn(),
    setScope: vi.fn(),
    setExcludeInstances: vi.fn(),
    setExcludeLocked: vi.fn(),
    setExcludeHidden: vi.fn(),
    setComposing: vi.fn(),
    search: vi.fn(),
    updateFromSelection: vi.fn(),
    replace: vi.fn(),
    replaceAndFindNext: vi.fn(),
    replaceChecked: vi.fn(),
    replaceAll: vi.fn(),
    replaceInSelection: vi.fn(),
    selectResult: vi.fn(),
    goToNext: vi.fn(),
    goToPrev: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
  };
}

describe('FindReplaceBar', () => {
  it('uses the accessible shared Select instead of a native select', () => {
    const { container } = render(<FindReplaceBar api={makeApi()} />);

    expect(screen.getByRole('dialog', { name: 'Find and replace' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Search scope' })).toBeTruthy();
    expect(container.querySelector('select')).toBeNull();
  });

  it('exposes find, replace, navigation, and scope controls', () => {
    render(<FindReplaceBar api={makeApi()} />);

    expect(screen.getByRole('textbox', { name: 'Find text' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Replace text' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next match' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous match' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Replace &/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace All' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update from selection' })).toBeTruthy();
  });

  it('disables replacement until a search has run', () => {
    render(<FindReplaceBar api={makeApi()} />);

    expect((screen.getByRole('button', { name: /Replace &/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Replace All' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('explains an empty selection instead of silently broadening scope', () => {
    const api = makeApi();
    api.state = { ...api.state, scope: 'selection', status: 'empty-selection', searchText: 'x' };
    render(<FindReplaceBar api={api} />);

    expect(screen.getByText(/Nothing is selected/i)).toBeTruthy();
  });
});
