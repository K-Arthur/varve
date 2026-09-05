import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  useFieldIds,
} from './Field';
import { useId } from 'react';

function TestFieldIds({ controlId }: { controlId?: string }) {
  const { id, errorId, descriptionId, hintId, mergeDescribedBy } = useFieldIds(controlId);
  return (
    <div>
      <span data-testid="id">{id}</span>
      <span data-testid="errorId">{errorId}</span>
      <span data-testid="descriptionId">{descriptionId}</span>
      <span data-testid="hintId">{hintId}</span>
      <span data-testid="describedBy">
        {mergeDescribedBy('caller-id', 'desc-id', 'error-id')}
      </span>
      <span data-testid="describedByEmpty">
        {mergeDescribedBy(undefined, undefined, undefined) || 'empty'}
      </span>
    </div>
  );
}

describe('Field', () => {
  it('renders children in a div by default', () => {
    render(
      <Field>
        <span>child</span>
      </Field>,
    );
    expect(screen.getByText('child').parentElement).toHaveClass('varve-field');
  });

  it('applies row layout class', () => {
    render(
      <Field layout="row">
        <span>child</span>
      </Field>,
    );
    expect(screen.getByText('child').parentElement).toHaveClass('varve-field--row');
  });

  it('applies disabled class', () => {
    render(
      <Field disabled>
        <span>child</span>
      </Field>,
    );
    expect(screen.getByText('child').parentElement).toHaveClass('varve-field--disabled');
  });

  it('renders as fieldset when as="fieldset"', () => {
    render(
      <Field as="fieldset">
        <span>child</span>
      </Field>,
    );
    const fieldset = screen.getByText('child').closest('fieldset');
    expect(fieldset).toBeInTheDocument();
    expect(fieldset).toHaveClass('varve-field');
  });

  it('applies custom className', () => {
    render(
      <Field className="custom">
        <span>child</span>
      </Field>,
    );
    expect(screen.getByText('child').parentElement).toHaveClass('varve-field', 'custom');
  });
});

describe('FieldLabel', () => {
  it('renders a label element', () => {
    render(<FieldLabel htmlFor="test-input">Name</FieldLabel>);
    const label = screen.getByText('Name');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', 'test-input');
  });

  it('applies varve-field__label class', () => {
    render(<FieldLabel>Name</FieldLabel>);
    expect(screen.getByText('Name')).toHaveClass('varve-field__label');
  });

  it('shows required indicator', () => {
    render(<FieldLabel required>Email</FieldLabel>);
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('*')).toHaveClass('varve-field__required');
  });

  it('shows optional marker', () => {
    render(<FieldLabel optional>Email</FieldLabel>);
    expect(screen.getByText('(Optional)')).toHaveClass('varve-field__optional');
  });

  it('applies visually hidden class', () => {
    render(<FieldLabel visuallyHidden>Hidden</FieldLabel>);
    expect(screen.getByText('Hidden')).toHaveClass('varve-visually-hidden');
  });

  it('applies custom className', () => {
    render(<FieldLabel className="custom">Name</FieldLabel>);
    expect(screen.getByText('Name')).toHaveClass('varve-field__label', 'custom');
  });
});

describe('FieldDescription', () => {
  it('renders description text', () => {
    render(<FieldDescription id="desc">Help text</FieldDescription>);
    const el = screen.getByText('Help text');
    expect(el.tagName).toBe('P');
    expect(el).toHaveAttribute('id', 'desc');
    expect(el).toHaveClass('varve-field__description');
  });

  it('applies custom className', () => {
    render(<FieldDescription className="custom">text</FieldDescription>);
    expect(screen.getByText('text')).toHaveClass('varve-field__description', 'custom');
  });
});

describe('FieldError', () => {
  it('renders error with role="alert"', () => {
    render(<FieldError id="err">Invalid</FieldError>);
    const el = screen.getByRole('alert');
    expect(el).toHaveTextContent('Invalid');
    expect(el).toHaveAttribute('id', 'err');
    expect(el).toHaveClass('varve-field__error');
  });

  it('applies custom className', () => {
    render(<FieldError className="custom">Error</FieldError>);
    expect(screen.getByRole('alert')).toHaveClass('varve-field__error', 'custom');
  });
});

describe('FieldControl', () => {
  it('renders children in a div', () => {
    render(
      <FieldControl>
        <input />
      </FieldControl>,
    );
    expect(screen.getByRole('textbox').parentElement).toHaveClass('varve-field__control');
  });

  it('applies custom className', () => {
    render(
      <FieldControl className="custom">
        <input />
      </FieldControl>,
    );
    expect(screen.getByRole('textbox').parentElement).toHaveClass('varve-field__control', 'custom');
  });
});

describe('useFieldIds', () => {
  it('generates unique IDs', () => {
    const { unmount } = render(<TestFieldIds />);
    const id1 = screen.getByTestId('id').textContent;
    unmount();
    render(<TestFieldIds />);
    const id2 = screen.getByTestId('id').textContent;
    expect(id1).not.toBe(id2);
  });

  it('uses provided controlId', () => {
    render(<TestFieldIds controlId="my-input" />);
    expect(screen.getByTestId('id')).toHaveTextContent('my-input');
    expect(screen.getByTestId('errorId')).toHaveTextContent('my-input-error');
    expect(screen.getByTestId('descriptionId')).toHaveTextContent('my-input-description');
    expect(screen.getByTestId('hintId')).toHaveTextContent('my-input-hint');
  });

  it('merges describedBy IDs correctly', () => {
    render(<TestFieldIds />);
    expect(screen.getByTestId('describedBy')).toHaveTextContent('caller-id desc-id error-id');
  });

  it('returns undefined-equivalent when no IDs provided', () => {
    render(<TestFieldIds />);
    expect(screen.getByTestId('describedByEmpty')).toHaveTextContent('empty');
  });
});

describe('Field — composition', () => {
  it('composes a complete field with label, control, description, and error', () => {
    render(
      <Field>
        <FieldLabel htmlFor="email">Email</FieldLabel>
        <input id="email" type="email" />
        <FieldDescription id="email-desc">We won't share this.</FieldDescription>
        <FieldError id="email-err">Invalid email.</FieldError>
      </Field>,
    );

    const input = screen.getByLabelText('Email');
    expect(input).toBeInTheDocument();
    expect(screen.getByText("We won't share this.")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email.');
  });

  it('composes a compact row layout', () => {
    render(
      <Field layout="row">
        <FieldLabel htmlFor="x-input">X</FieldLabel>
        <FieldControl>
          <input id="x-input" type="number" />
        </FieldControl>
      </Field>,
    );

    const input = screen.getByLabelText('X');
    expect(input).toBeInTheDocument();
    expect(input.parentElement).toHaveClass('varve-field__control');
  });
});
