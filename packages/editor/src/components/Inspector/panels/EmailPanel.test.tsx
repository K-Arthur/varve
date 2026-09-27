// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  addChild,
  createDocument,
  DEFAULT_EMAIL_PROFILE,
  DEFAULT_EMAIL_SEMANTIC_MAP,
  makeTextNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../../../context';
import { EmailPanel } from './EmailPanel';

function emailDocument(includeOrphanSource = false) {
  const initial = createDocument('Email test');
  const rootId = initial.pages?.[0]?.contentRoot;
  if (!rootId) throw new Error('The email fixture needs a page root.');
  const withCopy = addChild(initial, rootId, makeTextNode('email-copy', 'Hello {{firstName}}'));
  return {
    ...withCopy,
    emailProfile: DEFAULT_EMAIL_PROFILE,
    emailSemantics: {
      ...DEFAULT_EMAIL_SEMANTIC_MAP,
      variables: [{ id: 'first-name', name: 'firstName', type: 'text', sampleValue: 'Avery' }],
      customHtmlBlocks: includeOrphanSource
        ? { removed: { code: '<div>Preserved source</div>', userAuthored: true } }
        : {},
    },
  };
}

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

    fireEvent.click(screen.getByRole('button', { name: 'Plain text' }));
    expect(screen.getByRole('region', { name: 'Generated email plain text' })).toBeInTheDocument();
  });

  it('keeps orphaned authored source blocks discoverable and editable', async () => {
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(emailDocument(true))}>
        <EmailPanel />
      </EditorProvider>,
    );

    await screen.findByText('Source block · removed');
    fireEvent.click(screen.getByText('Source block · removed'));
    expect(
      screen.getByText('The source is preserved without a matching visible scene node.'),
    ).toBeVisible();
    const editor = screen.getByRole('textbox', { name: 'Authored HTML source for removed' });
    expect(editor).toHaveValue('<div>Preserved source</div>');
    fireEvent.change(editor, { target: { value: '<div>Edited but still authored</div>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save source block' }));
    expect(editor).toHaveValue('<div>Edited but still authored</div>');
  });

  it('uses sample values only in the browser preview, never in generated export HTML', async () => {
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(emailDocument())}>
        <EmailPanel />
      </EditorProvider>,
    );

    const preview = await screen.findByTitle('Email browser preview');
    expect(preview.getAttribute('srcdoc')).not.toContain('Avery');
    fireEvent.click(screen.getByRole('switch', { name: 'Preview sample values' }));
    await waitFor(() => expect(preview.getAttribute('srcdoc')).toContain('Avery'));

    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    const generated = screen.getByRole('textbox', { name: 'Generated email HTML' });
    expect((generated as HTMLTextAreaElement).value).toContain('{{firstName}}');
    expect((generated as HTMLTextAreaElement).value).not.toContain('Avery');
  });
});
