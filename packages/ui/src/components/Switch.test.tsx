import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch, SwitchField } from './Switch';

describe('Switch', () => {
  it('renders with label', () => {
    render(<Switch label="Enable" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Enable' })).toBeInTheDocument();
  });

  it('reflects checked state via aria-checked', () => {
    render(<Switch label="Enable" checked onChange={() => {}} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles on click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch label="Enable" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalled();
  });

  it('disables when disabled', () => {
    render(<Switch label="Enable" checked={false} onChange={() => {}} disabled />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('supports uncontrolled toggling without duplicating the native input', async () => {
    const user = userEvent.setup();
    render(<Switch label="Enable" defaultChecked={false} />);
    const control = screen.getByRole('switch');

    expect(control).toHaveAttribute('aria-checked', 'false');
    control.focus();
    await user.keyboard('[Space]');
    expect(control).toBeChecked();
    expect(control).toHaveAttribute('aria-checked', 'true');
  });

  it('follows external controlled updates', () => {
    const { rerender } = render(<Switch label="Enable" checked={false} onChange={() => {}} />);
    const control = screen.getByRole('switch');
    rerender(<Switch label="Enable" checked onChange={() => {}} />);
    expect(control).toBeChecked();
    expect(control).toHaveAttribute('aria-checked', 'true');
  });

  it('does not call onChange when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch label="Enable" defaultChecked={false} disabled onChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('resets an uncontrolled switch with its containing form', async () => {
    const user = userEvent.setup();
    render(
      <form>
        <Switch label="Enable" defaultChecked={false} />
        <button type="reset">Reset</button>
      </form>,
    );
    const control = screen.getByRole('switch');
    await user.click(control);
    expect(control).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(control).not.toBeChecked();
    expect(control).toHaveAttribute('aria-checked', 'false');
  });
});

describe('SwitchField', () => {
  it('associates its label and description with the switch', () => {
    render(
      <SwitchField
        label="GPU acceleration"
        description="Use hardware acceleration where available."
        checked={false}
        onChange={() => {}}
      />,
    );
    const control = screen.getByRole('switch', { name: 'GPU acceleration' });
    const describedBy = control.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(
      'Use hardware acceleration where available.',
    );
  });

  it('generates unique ids for repeated fields', () => {
    render(
      <>
        <SwitchField label="First" checked={false} onChange={() => {}} />
        <SwitchField label="Second" checked={false} onChange={() => {}} />
      </>,
    );
    const controls = screen.getAllByRole('switch');
    expect(controls[0]?.id).not.toBe(controls[1]?.id);
    expect(screen.getByLabelText('First')).toBe(controls[0]);
    expect(screen.getByLabelText('Second')).toBe(controls[1]);
  });
});
