/**
 * Export filename tokens and sanitization (M13, ADR-0167).
 */

import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { addPage, createDocument } from '../document';
import {
  expandExportFilename,
  pageExportNameContext,
  sanitizeExportFilename,
} from '../exportNaming';

function doc(): Document {
  let d = createDocument('My Book', false);
  d = addPage(d, {});
  return d;
}

describe('export filename tokens (M13)', () => {
  it('expands every token from the page context', () => {
    const d = doc();
    const ctx = pageExportNameContext(d, d.pages![0]!.id);
    const name = expandExportFilename(
      '{document}-{pageNumber}-{pageIndex}-{section}-{pageName}-{spread}',
      ctx,
    );
    expect(name).toContain('My Book');
    expect(name).toContain('-1-1-'); // pageNumber + pageIndex (1-based)
    expect(name).toContain('unsectioned');
    expect(name).toContain(d.pages![0]!.name);
  });

  it('sanitizes reserved characters and device names', () => {
    expect(sanitizeExportFilename('con.pdf')).toBe('_con.pdf');
    expect(sanitizeExportFilename('a/b:c*.png')).toBe('a_b_c_.png');
    expect(sanitizeExportFilename('trailing...')).toBe('trailing');
    expect(sanitizeExportFilename('...')).toBe('_');
  });
});
