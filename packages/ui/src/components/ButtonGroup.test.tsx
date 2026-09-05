import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';
import { ButtonGroup } from './ButtonGroup';

describe('ButtonGroup', () => {
  it('names a connected action group and preserves member semantics', () => {
    const { container } = render(
      <ButtonGroup label="Document actions">
        <Button variant="outline">Back</Button>
        <Button>Apply</Button>
      </ButtonGroup>,
    );

    expect(screen.getByRole('group', { name: 'Document actions' })).toBeInTheDocument();
    expect(container.querySelectorAll('.varve-btn-group > .varve-btn')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('type', 'button');
  });

  it('supports vertical groups without changing the action API', () => {
    const { container } = render(
      <ButtonGroup orientation="vertical">
        <Button>One</Button>
        <Button>Two</Button>
      </ButtonGroup>,
    );

    expect(container.querySelector('.varve-btn-group--vertical')).toBeInTheDocument();
  });
});
