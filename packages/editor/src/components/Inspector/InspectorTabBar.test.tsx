// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getOverflowedInspectorTabIds, InspectorTabBar } from './InspectorTabBar';

const tabs = [
  {
    id: 'properties' as const,
    label: 'Design',
    visible: true,
    group: 'primary' as const,
    overflowPriority: 0,
  },
  {
    id: 'prototype' as const,
    label: 'Prototype',
    visible: true,
    group: 'workflow' as const,
    overflowPriority: 1,
  },
  {
    id: 'audit' as const,
    label: 'Audit',
    visible: true,
    group: 'output' as const,
    overflowPriority: 5,
  },
  {
    id: 'export' as const,
    label: 'Export',
    visible: true,
    group: 'output' as const,
    overflowPriority: 2,
  },
];

describe('InspectorTabBar', () => {
  it('overflows the highest-priority tabs first while pinning Design and the active tab', () => {
    const widths = new Map([
      ['properties', 70],
      ['prototype', 80],
      ['audit', 60],
      ['export', 60],
    ]) as ReadonlyMap<(typeof tabs)[number]['id'], number>;

    expect(getOverflowedInspectorTabIds(tabs, 180, widths, 'properties')).toEqual([
      'audit',
      'export',
    ]);
    expect(getOverflowedInspectorTabIds(tabs, 180, widths, 'audit')).toEqual([
      'prototype',
      'export',
    ]);
  });

  it('does not overflow when the available width is sufficient', () => {
    const widths = new Map([
      ['properties', 70],
      ['prototype', 80],
      ['audit', 60],
      ['export', 60],
    ]) as ReadonlyMap<(typeof tabs)[number]['id'], number>;
    expect(getOverflowedInspectorTabIds(tabs, 270, widths, 'properties')).toEqual([]);
  });

  it('keeps overflow entries as menu items instead of duplicate tabs', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 150,
    });
    const onActivate = vi.fn();
    render(<InspectorTabBar tabs={tabs} activeTab="properties" onActivate={onActivate} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /more inspector tabs/i })).toBeVisible(),
    );
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Design']);

    fireEvent.click(screen.getByRole('button', { name: /more inspector tabs/i }));
    expect(screen.getByRole('menu', { name: 'More inspector tabs' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Audit' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Audit' })).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Audit' }));
    expect(onActivate).toHaveBeenCalledWith('audit');
  });
});
