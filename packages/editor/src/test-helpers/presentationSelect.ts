// Shared test helper for the presentation panels' converted Select controls.
//
// The presentation surfaces use the shared @varve/ui `Select`, which is a
// button + listbox rather than a native select control, so a test cannot call
// `user.selectOptions` on it. These helpers keep the same intent — choose by
// accessible name, then by option value or by option label — through the
// listbox, and they fail with the option list when a value is not present so a
// renamed option is diagnosable rather than silent.
import { fireEvent, screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

type User = ReturnType<typeof userEvent.setup>;

function optionNode(listbox: HTMLElement, valueOrLabel: string | RegExp): HTMLElement | null {
  const byName = within(listbox).queryByRole('option', { name: valueOrLabel } as never);
  if (byName) return byName as HTMLElement;
  if (valueOrLabel instanceof RegExp) return null;
  return (
    (within(listbox)
      .queryAllByRole('option')
      .find((option) => option.textContent?.trim() === valueOrLabel) as HTMLElement | undefined) ??
    null
  );
}

function describeOptions(listbox: HTMLElement): string {
  return within(listbox)
    .queryAllByRole('option')
    .map((option) => option.textContent?.trim())
    .join(' | ');
}

export async function chooseOption(
  user: User,
  name: string,
  valueOrLabel: string | RegExp,
): Promise<void> {
  const trigger = screen.getByRole('combobox', { name });
  await user.click(trigger);
  const listbox = await screen.findByRole('listbox', { name });
  const option = optionNode(listbox, valueOrLabel);
  if (!option) {
    throw new Error(
      `Value "${String(valueOrLabel)}" not found in options for "${name}": ${describeOptions(listbox)}`,
    );
  }
  await user.click(option);
}

/** Fire-and-forget variant for fixtures that drive the UI with fireEvent only. */
export function chooseOptionSync(name: string, valueOrLabel: string | RegExp): void {
  fireEvent.click(screen.getByRole('combobox', { name }));
  const listbox = screen.getByRole('listbox', { name });
  const option = optionNode(listbox, valueOrLabel);
  if (!option) {
    throw new Error(
      `Value "${String(valueOrLabel)}" not found in options for "${name}": ${describeOptions(listbox)}`,
    );
  }
  fireEvent.click(option);
}
