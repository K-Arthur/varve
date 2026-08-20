/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FontCatalog, type FontSubstitute, type MissingFontInfo } from '@varve/engine/font';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissingFontDialog } from './MissingFontDialog';

afterEach(cleanup);

function makeCatalog(): FontCatalog {
  const catalog = new FontCatalog();
  catalog.addEntry({
    identity: {
      contentHash: 'inter',
      postScriptName: 'Inter-Regular',
      familyName: 'Inter',
      subfamilyName: 'Regular',
      fullName: 'Inter Regular',
    },
    format: 'woff2',
    fileSize: 1,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
    glyphCount: 1,
    isVariable: false,
    axes: [],
    namedInstances: [],
    openTypeFeatures: [],
    unicodeRanges: [],
    scripts: ['latn'],
    embeddingRights: 'installable',
    hasColorGlyphs: false,
    category: 'sans-serif',
    source: 'bundled',
  });
  return catalog;
}

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

describe('MissingFontDialog', () => {
  it('explains the replacement scope and preserves the original reference in the UI', () => {
    render(
      <MissingFontDialog
        missingFonts={[makeMissingFont()]}
        catalog={makeCatalog()}
        onReplace={vi.fn()}
        onReplaceAll={vi.fn()}
        onDismiss={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveAttribute(
      'aria-describedby',
      'missing-font-dialog-description missing-font-dialog-warning',
    );
    expect(screen.getByText('Original: Missing Display')).toBeInTheDocument();
    expect(screen.getByText(/rich-text runs and shared text styles/i)).toBeInTheDocument();
    expect(screen.getByText(/Inter \(compatible\)/i)).toBeInTheDocument();
  });

  it('submits the ranked default replacement as one bulk mapping', async () => {
    const user = userEvent.setup();
    const onReplaceAll = vi.fn();
    render(
      <MissingFontDialog
        missingFonts={[makeMissingFont()]}
        catalog={makeCatalog()}
        onReplace={vi.fn()}
        onReplaceAll={onReplaceAll}
        onDismiss={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Replace All' }));

    expect(onReplaceAll).toHaveBeenCalledTimes(1);
    const mapping = onReplaceAll.mock.calls[0]?.[0] as Map<string, string>;
    expect(mapping.get('Missing Display')).toBe('Inter');
  });

  it('uses the close callback for Escape and the visible close control', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MissingFontDialog
        missingFonts={[makeMissingFont()]}
        catalog={makeCatalog()}
        onReplace={vi.fn()}
        onReplaceAll={vi.fn()}
        onDismiss={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
