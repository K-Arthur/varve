/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  type FontSubstitute,
  type FontsourceCatalogSnapshot,
  FontsourceCatalogStore,
  type MissingFontInfo,
} from '@varve/engine/font';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissingFontDialog } from './MissingFontDialog';
import { findMissingFontRecoveryMatch } from './missingFontRecovery';

afterEach(cleanup);

function makeMissingFont(): MissingFontInfo {
  const substitute: FontSubstitute = {
    familyName: 'Inter',
    matchQuality: 'compatible',
    confidence: 0.7,
    source: 'bundled',
    availableVariants: [{ weight: 400, style: 'normal' }],
  };
  return {
    familyName: 'Missing Display',
    originalReference: 'Missing Display',
    requestedWeight: 700,
    requestedStyle: 'normal',
    nodeIds: ['text-1', 'text-2'],
    status: 'missing',
    substitutes: [substitute],
  };
}

function makeRecoveryMatches(missing = makeMissingFont()) {
  const snapshot: FontsourceCatalogSnapshot = {
    schemaVersion: 1,
    providerId: 'fontsource',
    sourceUrl: 'https://api.fontsource.org/v1/fonts',
    generatedBy: 'test',
    generatedAt: '2026-09-01T00:00:00.000Z',
    sourceRevision: 'test',
    checksum: 'test',
    families: [
      {
        providerId: 'fontsource',
        familyId: 'missing-display',
        familyName: 'Missing Display',
        aliases: [],
        category: 'sans-serif',
        subsets: ['latin'],
        defaultSubset: 'latin',
        weights: [400, 700],
        styles: ['normal'],
        variable: false,
        axes: [],
        unicodeRange: {},
        upstreamVersion: '1.0.0',
        packageVersion: '5.3.0',
        lastModified: '2026-01-01',
        license: {
          id: 'OFL-1.1',
          name: 'SIL Open Font License 1.1',
          commercial: true,
          modification: true,
          redistribution: true,
          embedding: true,
        },
      },
    ],
  };
  const match = findMissingFontRecoveryMatch(missing, new FontsourceCatalogStore(snapshot));
  return new Map(match ? [[missing.familyName, match]] : []);
}

function dialogProps(missingFonts = [makeMissingFont()]) {
  return {
    missingFonts,
    recoveryMatches: makeRecoveryMatches(missingFonts[0]),
    onReplace: vi.fn(),
    onReplaceAll: vi.fn(),
    onInstallFontsource: vi.fn().mockResolvedValue(undefined),
    onBrowseCatalog: vi.fn(),
    onDismiss: vi.fn(),
    onClose: vi.fn(),
  };
}

describe('MissingFontDialog', () => {
  it('explains the replacement scope and preserves the original reference in the UI', () => {
    render(<MissingFontDialog {...dialogProps()} />);

    expect(screen.getByRole('dialog')).toHaveAttribute(
      'aria-describedby',
      'missing-font-dialog-description missing-font-dialog-warning',
    );
    expect(screen.getByText('Original: Missing Display')).toBeInTheDocument();
    expect(screen.getByText(/rich-text runs, and shared text styles/i)).toBeInTheDocument();
    expect(screen.getByText(/Inter \(compatible\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Exact family available from Fontsource/i)).toBeInTheDocument();
    expect(screen.getByText(/SIL Open Font License/i)).toBeInTheDocument();
  });

  it('submits the ranked default replacement as one bulk mapping', async () => {
    const user = userEvent.setup();
    const onReplaceAll = vi.fn();
    render(<MissingFontDialog {...dialogProps()} onReplaceAll={onReplaceAll} />);

    await user.click(screen.getByRole('button', { name: 'Replace All' }));

    expect(onReplaceAll).toHaveBeenCalledTimes(1);
    const mapping = onReplaceAll.mock.calls[0]?.[0] as Map<string, string>;
    expect(mapping.get('Missing Display')).toBe('Inter');
  });

  it('uses the close callback for Escape and the visible close control', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MissingFontDialog {...dialogProps()} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('installs only after an explicit action and exposes the exact face request', async () => {
    const user = userEvent.setup();
    const onInstallFontsource = vi.fn().mockResolvedValue(undefined);
    const props = dialogProps();
    render(<MissingFontDialog {...props} onInstallFontsource={onInstallFontsource} />);

    expect(onInstallFontsource).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Install Missing Display 700' }));

    expect(onInstallFontsource).toHaveBeenCalledWith(
      props.missingFonts[0],
      props.recoveryMatches.get('Missing Display'),
    );
  });

  it('keeps Fontsource downloads disabled when the deployment restricts them', () => {
    render(
      <MissingFontDialog
        {...dialogProps()}
        downloadRestrictionMessage="Additional font downloads are unavailable in this demo."
      />,
    );

    expect(screen.getByRole('button', { name: 'Install Missing Display 700' })).toBeDisabled();
    expect(screen.getByText(/downloads are unavailable in this demo/i)).toBeInTheDocument();
  });

  it('prevents replacement and browser races while an exact install is pending', async () => {
    const user = userEvent.setup();
    const onInstallFontsource = vi.fn(() => new Promise<void>(() => undefined));
    render(<MissingFontDialog {...dialogProps()} onInstallFontsource={onInstallFontsource} />);

    await user.click(screen.getByRole('button', { name: 'Install Missing Display 700' }));

    expect(screen.getByRole('button', { name: 'Browse fonts' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Replace All' })).toBeDisabled();
  });

  it('opens the full catalog for alternatives', async () => {
    const user = userEvent.setup();
    const onBrowseCatalog = vi.fn();
    const props = dialogProps();
    render(<MissingFontDialog {...props} onBrowseCatalog={onBrowseCatalog} />);

    await user.click(screen.getByRole('button', { name: 'Browse fonts' }));
    expect(onBrowseCatalog).toHaveBeenCalledWith(props.missingFonts[0]);
  });

  it('refreshes default selections when the missing-font set changes', async () => {
    const second = {
      ...makeMissingFont(),
      familyName: 'Another Missing',
      originalReference: 'Another Missing',
    };
    const onReplaceAll = vi.fn();
    const { rerender } = render(
      <MissingFontDialog {...dialogProps()} onReplaceAll={onReplaceAll} />,
    );

    rerender(
      <MissingFontDialog
        {...dialogProps([second])}
        recoveryMatches={new Map()}
        onReplaceAll={onReplaceAll}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Replace All' }));

    const mapping = onReplaceAll.mock.calls[0]?.[0] as Map<string, string>;
    expect(mapping.has('Missing Display')).toBe(false);
    expect(mapping.get('Another Missing')).toBe('Inter');
  });
});
