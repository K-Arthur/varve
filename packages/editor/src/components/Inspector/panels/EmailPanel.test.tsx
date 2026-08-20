// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../../../context';
import { EmailPanel } from './EmailPanel';

describe('EmailPanel', () => {
  it('enables a normal document and exposes safe desktop/mobile preview controls', async () => {
    render(
      <EditorProvider>
        <EmailPanel />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Enable email template' }));

    await waitFor(() => expect(screen.getByTitle('Email browser preview')).toBeVisible());
    expect(screen.getByRole('button', { name: 'Desktop' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mobile' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Generated email HTML (read-only)' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(document.querySelector('.email-panel__preview-frame--mobile')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(
      screen.getByRole('region', { name: 'Generated email HTML (read-only)' }),
    ).toBeInTheDocument();
  });
});
