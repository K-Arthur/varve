import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DisclosureSection } from './DisclosureSection';
import { FieldRow } from './FieldRow';
import { SegmentedControl } from './SegmentedControl';

afterEach(cleanup);

describe('FieldRow', () => {
  it('renders an associated label and the control', () => {
    render(
      <FieldRow label="Direction" htmlFor="dir">
        <select id="dir">
          <option>Row</option>
        </select>
      </FieldRow>,
    );
    expect(screen.getByText('Direction').tagName).toBe('LABEL');
    expect(screen.getByLabelText('Direction')).toBeTruthy();
  });
});

describe('DisclosureSection', () => {
  it('renders a trigger button with APG disclosure semantics', () => {
    render(
      <DisclosureSection title="Position">
        <div>content</div>
      </DisclosureSection>,
    );
    const trigger = screen.getByRole('button', { name: /position/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('toggles content visibility on click', () => {
    render(
      <DisclosureSection title="Size" defaultExpanded={true}>
        <div>size-content</div>
      </DisclosureSection>,
    );
    const trigger = screen.getByRole('button', { name: /size/i });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('size-content')).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('size-content')).toBeTruthy();
  });

  it('persists expansion state across remounts via sessionStorage', () => {
    sessionStorage.setItem('strata:inspector:disclosure:persist-test', '0');
    const { unmount } = render(
      <DisclosureSection title="Persist Test" id="persist-test" defaultExpanded={true}>
        <div>x</div>
      </DisclosureSection>,
    );
    let trigger = screen.getByRole('button', { name: /persist test/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    unmount();
    render(
      <DisclosureSection title="Persist Test" id="persist-test" defaultExpanded={true}>
        <div>x</div>
      </DisclosureSection>,
    );
    trigger = screen.getByRole('button', { name: /persist test/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    sessionStorage.removeItem('strata:inspector:disclosure:persist-test');
  });
});

describe('SegmentedControl', () => {
  type Dir = 'row' | 'column';
  const options: { value: Dir; label: string }[] = [
    { value: 'row', label: 'Row' },
    { value: 'column', label: 'Column' },
  ];

  it('renders a radiogroup with one checked radio', () => {
    render(
      <SegmentedControl label="Direction" value="row" options={options} onChange={() => {}} />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Direction' });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');
    expect(radios[1]?.getAttribute('aria-checked')).toBe('false');
  });

  it('selects an option on click', () => {
    let val: Dir = 'row';
    render(
      <SegmentedControl
        label="Direction"
        value={val}
        options={options}
        onChange={(v) => (val = v)}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Column' }));
    expect(val).toBe('column');
  });

  it('moves selection with ArrowRight (roving tabindex)', () => {
    let val: Dir = 'row';
    render(
      <SegmentedControl
        label="Direction"
        value={val}
        options={options}
        onChange={(v) => (val = v)}
      />,
    );
    const radios = screen.getAllByRole('radio');
    const firstRadio = radios[0];
    if (!firstRadio) throw new Error('first radio not found');
    fireEvent.keyDown(firstRadio, { key: 'ArrowRight' });
    expect(val).toBe('column');
  });
});
