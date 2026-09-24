import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DisclosureSection } from './DisclosureSection';
import { FieldRow } from './FieldRow';

afterEach(cleanup);

describe('FieldRow', () => {
  it('renders an associated label and the control', () => {
    render(
      <FieldRow label="Direction" htmlFor="direction">
        <select id="direction">
          <option>Row</option>
        </select>
      </FieldRow>,
    );
    expect(screen.getByLabelText('Direction')).toBe(screen.getByRole('combobox'));
  });
});

describe('DisclosureSection legacy mode', () => {
  it('renders the trigger with disclosure semantics and its content', () => {
    render(
      <DisclosureSection title="Position">
        <div>content</div>
      </DisclosureSection>,
    );
    const trigger = screen.getByRole('button', { name: /position/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls');
    expect(screen.getByText('content')).toBeVisible();
  });

  it('toggles content visibility on click', () => {
    render(
      <DisclosureSection title="Size" id="legacy-size" defaultExpanded>
        <div>size-content</div>
      </DisclosureSection>,
    );
    const trigger = screen.getByRole('button', { name: /size/i });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('size-content')).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('size-content')).toBeVisible();
  });

  it('keeps a sibling action outside the disclosure trigger', () => {
    render(
      <DisclosureSection
        title="Fills"
        defaultExpanded={false}
        action={<button type="button">Add fill</button>}
      >
        <div>fill-content</div>
      </DisclosureSection>,
    );
    const trigger = screen.getByRole('button', { name: /^fills$/i });
    const action = screen.getByRole('button', { name: /add fill/i });
    expect(action.parentElement?.className).toContain('insp-disclosure__action');
    expect(action.closest('button')).toBe(action);
    fireEvent.click(action);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('persists the legacy expansion state across remounts', () => {
    sessionStorage.setItem('strata:inspector:disclosure:legacy-persist', '0');
    const props = { title: 'Persist Test', id: 'legacy-persist', defaultExpanded: true };
    const { unmount } = render(
      <DisclosureSection {...props}>
        <div>persisted-content</div>
      </DisclosureSection>,
    );
    expect(screen.getByRole('button', { name: /persist test/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    unmount();

    render(
      <DisclosureSection {...props}>
        <div>persisted-content</div>
      </DisclosureSection>,
    );
    expect(screen.getByRole('button', { name: /persist test/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    sessionStorage.removeItem('strata:inspector:disclosure:legacy-persist');
  });
});
