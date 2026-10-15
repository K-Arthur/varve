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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, setToastHandler } from '../../../context';
import { resetPanelLocalStateForTest } from '../../../workspace/panelLocalState';
import { EmailOutputPanel } from './EmailOutputPanel';
import { EmailPanel } from './EmailPanel';
import { EmailPreviewPanel } from './EmailPreviewPanel';

const { mockSaveExportBytes } = vi.hoisted(() => ({
  mockSaveExportBytes: vi.fn(),
}));

vi.mock('../../../exportSaveAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../exportSaveAdapter')>();
  return {
    ...actual,
    saveExportBytes: mockSaveExportBytes,
  };
});

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
  beforeEach(() => {
    resetPanelLocalStateForTest();
    mockSaveExportBytes.mockReset();
    mockSaveExportBytes.mockResolvedValue('email.html');
    setToastHandler(null);
  });

  afterEach(() => {
    setToastHandler(null);
  });

  it('enables a normal document and exposes safe desktop/mobile preview controls', async () => {
    render(
      <EditorProvider>
        <EmailPanel />
        <EmailPreviewPanel />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Enable email template' }));

    await waitFor(() => expect(screen.getByTitle('Email browser preview')).toBeVisible());
    expect(screen.getByRole('button', { name: 'Desktop' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mobile' })).toBeVisible();
    expect(screen.queryByTestId('email-output-panel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(document.querySelector('.email-panel__preview-frame--mobile')).toBeInTheDocument();
    expect(screen.queryByTestId('email-output-panel')).toBeNull();
  });

  it('renders the singleton Email Output surface independently from Inspector authoring', async () => {
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(emailDocument())}>
        <EmailOutputPanel />
      </EditorProvider>,
    );

    expect(await screen.findByTestId('email-output-panel')).toHaveAttribute(
      'data-panel',
      'emailOutput',
    );
    expect(screen.getByRole('region', { name: 'Generated email HTML (read-only)' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Generated email plain text' })).toBeVisible();
  });

  it('keeps orphaned authored source blocks discoverable and editable', async () => {
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(emailDocument(true))}>
        <EmailOutputPanel />
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

  it('retains Output scroll, expanded source blocks, and unsaved drafts across remounts', async () => {
    const initialDocumentJson = JSON.stringify(emailDocument(true));
    const firstMount = render(
      <EditorProvider initialDocumentJson={initialDocumentJson}>
        <EmailOutputPanel />
      </EditorProvider>,
    );
    const panel = await screen.findByTestId('email-output-panel');
    panel.scrollTop = 420;
    fireEvent.scroll(panel);
    const summary = screen.getByText('Source block · removed');
    fireEvent.click(summary);
    const editor = screen.getByRole('textbox', { name: 'Authored HTML source for removed' });
    fireEvent.change(editor, { target: { value: '<div>Draft survives remount</div>' } });
    await waitFor(() => expect(panel.scrollTop).toBe(420));
    await waitFor(() => expect(editor).toHaveValue('<div>Draft survives remount</div>'));
    firstMount.unmount();

    render(
      <EditorProvider initialDocumentJson={initialDocumentJson}>
        <EmailOutputPanel />
      </EditorProvider>,
    );

    const restoredPanel = await screen.findByTestId('email-output-panel');
    await waitFor(() => expect(restoredPanel.scrollTop).toBe(420));
    expect(screen.getByText('Source block · removed').closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('textbox', { name: 'Authored HTML source for removed' })).toHaveValue(
      '<div>Draft survives remount</div>',
    );
  });

  it('uses sample values only in the browser preview, never in generated export HTML', async () => {
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(emailDocument())}>
        <EmailOutputPanel />
        <EmailPreviewPanel />
      </EditorProvider>,
    );

    const preview = await screen.findByTitle('Email browser preview');
    expect(preview.getAttribute('srcdoc')).not.toContain('Avery');
    fireEvent.click(screen.getByRole('switch', { name: 'Preview sample values' }));
    await waitFor(() => expect(preview.getAttribute('srcdoc')).toContain('Avery'));

    const generated = screen.getByRole('textbox', { name: 'Generated email HTML' });
    expect((generated as HTMLTextAreaElement).value).toContain('{{firstName}}');
    expect((generated as HTMLTextAreaElement).value).not.toContain('Avery');
  });

  it('returns without an error toast when HTML email export is cancelled', async () => {
    const toast = vi.fn();
    setToastHandler(toast);
    mockSaveExportBytes.mockResolvedValueOnce(null);

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(emailDocument())}>
        <EmailOutputPanel />
      </EditorProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Export HTML, text, and manifest' }));
    await waitFor(() => expect(mockSaveExportBytes).toHaveBeenCalledTimes(1));
    expect(toast).not.toHaveBeenCalled();
  });

  it('stops after a later cancel without a failure toast for the earlier writes', async () => {
    const toast = vi.fn();
    setToastHandler(toast);
    mockSaveExportBytes.mockResolvedValueOnce('email.html').mockResolvedValueOnce(null);

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(emailDocument())}>
        <EmailOutputPanel />
      </EditorProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Export HTML, text, and manifest' }));
    await waitFor(() => expect(mockSaveExportBytes).toHaveBeenCalledTimes(2));
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows an error toast when HTML email export fails', async () => {
    const toast = vi.fn();
    setToastHandler(toast);
    mockSaveExportBytes.mockRejectedValue(new Error('disk full'));

    render(
      <EditorProvider initialDocumentJson={JSON.stringify(emailDocument())}>
        <EmailOutputPanel />
      </EditorProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Export HTML, text, and manifest' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringMatching(/email export failed.*disk full/i),
        }),
      ),
    );
  });
});
