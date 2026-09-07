import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from './InputGroup';

describe('InputGroup', () => {
  it('composes a labelled input with an addon and action without overflow-prone wrappers', () => {
    render(
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>https://</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput aria-label="Website" />
        <InputGroupButton aria-label="Apply">Apply</InputGroupButton>
      </InputGroup>,
    );

    expect(screen.getByLabelText('Website')).toHaveAttribute('data-slot', 'input-group-input');
    expect(screen.getByText('https://')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveAttribute('type', 'button');
  });

  it('keeps action buttons keyboard-operable', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <InputGroup>
        <InputGroupInput aria-label="Value" />
        <InputGroupButton aria-label="Use value" onClick={onClick}>
          Use
        </InputGroupButton>
      </InputGroup>,
    );

    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('supports invalid and vertical group state', () => {
    render(
      <InputGroup orientation="vertical" invalid>
        <InputGroupAddon align="block-start">Token</InputGroupAddon>
        <InputGroupInput aria-label="Token value" />
      </InputGroup>,
    );

    const group = screen.getByLabelText('Token value').closest('[data-slot="input-group"]');
    expect(group).toHaveClass('varve-input-group--vertical');
    expect(group).toHaveAttribute('data-invalid', 'true');
  });
});
