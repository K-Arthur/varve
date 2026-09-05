import type { Meta, StoryObj } from '@storybook/react';
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from './Field';

const meta: Meta<typeof Field> = {
  title: 'Components/Field',
  component: Field,
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj<typeof Field>;

export const StandardField: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="email" required>Email address</FieldLabel>
      <input
        id="email"
        type="email"
        style={{
          padding: '8px',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '6px',
          background: 'var(--color-surface-sunken)',
          color: 'var(--color-text-primary)',
          width: '100%',
        }}
      />
      <FieldDescription id="email-desc">
        We will never share your email with third parties.
      </FieldDescription>
    </Field>
  ),
};

export const WithError: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="email-err">Email address</FieldLabel>
      <input
        id="email-err"
        type="email"
        aria-invalid="true"
        aria-describedby="email-err-msg"
        style={{
          padding: '8px',
          border: '1px solid var(--color-feedback-danger)',
          borderRadius: '6px',
          background: 'var(--color-surface-sunken)',
          color: 'var(--color-text-primary)',
          width: '100%',
        }}
      />
      <FieldError id="email-err-msg">Please enter a valid email address.</FieldError>
    </Field>
  ),
};

export const WithDescriptionAndError: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="pw" required>Password</FieldLabel>
      <input
        id="pw"
        type="password"
        aria-invalid="true"
        aria-describedby="pw-desc pw-err"
        style={{
          padding: '8px',
          border: '1px solid var(--color-feedback-danger)',
          borderRadius: '6px',
          background: 'var(--color-surface-sunken)',
          color: 'var(--color-text-primary)',
          width: '100%',
        }}
      />
      <FieldDescription id="pw-desc">At least 8 characters.</FieldDescription>
      <FieldError id="pw-err">Password is too short.</FieldError>
    </Field>
  ),
};

export const OptionalField: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="phone" optional>Phone number</FieldLabel>
      <input
        id="phone"
        type="tel"
        style={{
          padding: '8px',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '6px',
          background: 'var(--color-surface-sunken)',
          color: 'var(--color-text-primary)',
          width: '100%',
        }}
      />
      <FieldDescription id="phone-desc">For account recovery only.</FieldDescription>
    </Field>
  ),
};

export const CompactRow: Story = {
  render: () => (
    <Field layout="row">
      <FieldLabel htmlFor="x-coord">X</FieldLabel>
      <FieldControl>
        <input
          id="x-coord"
          type="number"
          defaultValue={120}
          style={{
            padding: '4px 8px',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '6px',
            background: 'var(--color-surface-sunken)',
            color: 'var(--color-text-primary)',
            width: '100%',
          }}
        />
      </FieldControl>
    </Field>
  ),
};

export const CompactRowDisabled: Story = {
  render: () => (
    <Field layout="row" disabled>
      <FieldLabel htmlFor="locked">Locked</FieldLabel>
      <FieldControl>
        <input
          id="locked"
          type="text"
          defaultValue="read-only"
          style={{
            padding: '4px 8px',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '6px',
            background: 'var(--color-surface-sunken)',
            color: 'var(--color-text-primary)',
            width: '100%',
          }}
        />
      </FieldControl>
    </Field>
  ),
};

export const FieldsetGroup: Story = {
  render: () => (
    <Field as="fieldset">
      <legend style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' }}>
        Notification preferences
      </legend>
      <Field layout="row">
        <FieldLabel htmlFor="email-notif">Email</FieldLabel>
        <FieldControl>
          <input
            id="email-notif"
            type="checkbox"
            defaultChecked
          />
        </FieldControl>
      </Field>
      <Field layout="row">
        <FieldLabel htmlFor="push-notif">Push</FieldLabel>
        <FieldControl>
          <input id="push-notif" type="checkbox" />
        </FieldControl>
      </Field>
    </Field>
  ),
};

export const VisuallyHiddenLabel: Story = {
  render: () => (
    <Field>
      <FieldLabel htmlFor="search-global" visuallyHidden>
        Search
      </FieldLabel>
      <input
        id="search-global"
        type="search"
        placeholder="Search..."
        aria-label="Search"
        style={{
          padding: '8px',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '6px',
          background: 'var(--color-surface-sunken)',
          color: 'var(--color-text-primary)',
          width: '100%',
        }}
      />
    </Field>
  ),
};

export const DarkMode: Story = {
  render: () => (
    <div data-theme="dark" style={{ background: '#10151f', padding: '24px' }}>
      <Field>
        <FieldLabel htmlFor="dark-email" required>Email</FieldLabel>
        <input
          id="dark-email"
          type="email"
          style={{
            padding: '8px',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '6px',
            background: 'var(--color-surface-sunken)',
            color: 'var(--color-text-primary)',
            width: '100%',
          }}
        />
        <FieldDescription id="dark-desc">
          We respect your privacy.
        </FieldDescription>
      </Field>
    </div>
  ),
};
