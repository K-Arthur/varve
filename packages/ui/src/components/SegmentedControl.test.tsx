import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

type Direction = 'row' | 'column';

const options: { value: Direction; label: string }[] = [
  { value: 'row', label: 'Row' },
  { value: 'column', label: 'Column' },
];

describe('SegmentedControl', () => {
  it('renders a radiogroup with exactly one checked radio', () => {
    render(
      <SegmentedControl label="Direction" value="row" options={options} onChange={() => {}} />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Direction' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
  });

  it('selects an option on click', () => {
    let val: Direction = 'row';
    render(
      <SegmentedControl
        label="Direction"
        value={val}
        options={options}
        onChange={(v) => {
          val = v;
        }}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Column' }));
    expect(val).toBe('column');
  });

  it('moves selection with ArrowRight (roving tabindex)', () => {
    let val: Direction = 'row';
    render(
      <SegmentedControl
        label="Direction"
        value={val}
        options={options}
        onChange={(v) => {
          val = v;
        }}
      />,
    );
    const firstRadio = screen.getAllByRole('radio')[0];
    if (!firstRadio) throw new Error('first radio not found');
    expect(firstRadio).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(firstRadio, { key: 'ArrowRight' });
    expect(val).toBe('column');
  });

  it('skips disabled options and exposes their reason', () => {
    let val: Direction = 'row';
    render(
      <SegmentedControl
        label="Direction"
        value={val}
        options={[
          { value: 'row', label: 'Row' },
          { value: 'column', label: 'Column', disabled: true, disabledReason: 'Unavailable' },
        ]}
        onChange={(v) => {
          val = v;
        }}
      />,
    );
    const disabled = screen.getByRole('radio', { name: 'Column' });
    expect(disabled).toBeDisabled();
    expect(disabled).toHaveAttribute('title', 'Unavailable');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Row' }), { key: 'ArrowRight' });
    expect(val).toBe('row');
  });

  it('keeps the accessible name when the visible label is hidden', () => {
    render(
      <SegmentedControl
        label="Direction"
        value="row"
        options={[
          { value: 'row', label: 'Row', hideLabel: true },
          { value: 'column', label: 'Column' },
        ]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Row' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Column' })).toBeInTheDocument();
  });

  it('applies the pill variant and extra class to the group', () => {
    render(
      <SegmentedControl
        label="View mode"
        value="row"
        options={options}
        onChange={() => {}}
        variant="pill"
        className="test-extra"
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'View mode' });
    expect(group).toHaveClass('varve-segmented', 'varve-segmented--pill', 'test-extra');
  });

  it('keeps the pill option name when the CSS collapses the visible label', () => {
    render(
      <SegmentedControl
        label="View mode"
        value="row"
        options={[
          { value: 'row', label: 'Grid' },
          { value: 'column', label: 'List' },
        ]}
        onChange={() => {}}
        variant="pill"
      />,
    );
    // The pill label span is display:none under 640px, so the input must
    // carry its own name (platform UX audit U5).
    expect(screen.getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-label', 'Grid');
  });

  it('disables every option when the group is disabled', () => {
    render(
      <SegmentedControl
        label="Direction"
        value="row"
        options={options}
        onChange={() => {}}
        disabled
      />,
    );
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
  });

  it('renders icon options', () => {
    const { container } = render(
      <SegmentedControl
        label="Direction"
        value="row"
        options={[
          { value: 'row', label: 'Row', icon: 'Circle' },
          { value: 'column', label: 'Column', icon: 'Square' },
        ]}
        onChange={() => {}}
      />,
    );
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
  });

  it('uses a native radio so selection needs no aria-checked override', () => {
    render(<SegmentedControl label="Direction" value="row" options={options} onChange={vi.fn()} />);
    const radio = screen.getByRole('radio', { name: 'Row' });
    expect(radio).toHaveProperty('tagName', 'INPUT');
    expect(radio).not.toHaveAttribute('aria-checked');
  });
});
