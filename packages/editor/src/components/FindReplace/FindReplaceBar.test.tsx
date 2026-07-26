import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FindReplaceAPI } from '../../findReplace/useFindReplace';
import { DEFAULT_FIND_REPLACE_STATE } from '../../findReplace/types';
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
    search: vi.fn(),
    replace: vi.fn(),
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
});
