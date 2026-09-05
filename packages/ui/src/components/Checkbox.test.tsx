import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('renders with label', () => {
    render(<Checkbox label="Accept" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Accept' })).toBeInTheDocument();
  });

  it('sets aria-checked="mixed" for indeterminate', () => {
    render(<Checkbox label="Select all" indeterminate checked={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'mixed');
  });

  it('sets aria-checked="true" when checked', () => {
    render(<Checkbox label="Accept" checked onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  });

  it('sets aria-checked="false" when unchecked', () => {
    render(<Checkbox label="Accept" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles on click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Checkbox label="Accept" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalled();
  });

  it('links description via aria-describedby', () => {
    render(
      <Checkbox
        label="Analytics"
        description="Help us improve the product."
        checked={false}
        onChange={() => {}}
      />,
    );
    const checkbox = screen.getByRole('checkbox');
    const describedBy = checkbox.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      'Help us improve the product.',
    );
  });

  it('links error via aria-describedby and sets aria-invalid', () => {
    render(
      <Checkbox
        label="Terms"
        error="You must accept the terms."
        checked={false}
        onChange={() => {}}
      />,
    );
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toHaveAttribute('aria-invalid', 'true');
    const describedBy = checkbox.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      'You must accept the terms.',
    );
  });

  it('merges description and error in aria-describedby', () => {
    render(
      <Checkbox
        label="Terms"
        description="Required for signup."
        error="You must accept."
        checked={false}
        onChange={() => {}}
      />,
    );
    const checkbox = screen.getByRole('checkbox');
    const ids = checkbox.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0])).toHaveTextContent('You must accept.');
    expect(document.getElementById(ids[1])).toHaveTextContent('Required for signup.');
  });

  it('displays description text visually', () => {
    render(
      <Checkbox
        label="Analytics"
        description="Help us improve."
        checked={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Help us improve.')).toHaveClass('varve-checkbox__description');
  });

  it('displays error text visually', () => {
    render(
      <Checkbox
        label="Terms"
        error="Required."
        checked={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Required.');
  });

  it('respects existing aria-describedby from rest props', () => {
    render(
      <Checkbox
        label="Terms"
        description="Read carefully."
        checked={false}
        onChange={() => {}}
        aria-describedby="external-desc"
      />,
    );
    const checkbox = screen.getByRole('checkbox');
    const describedBy = checkbox.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('external-desc');
  });
});
