import { describe, expect, it } from 'vitest';
import { emitEmailHtml } from './email-html';
import type { EmailDocumentIr } from './email-ir-types';
import { emitEmailPlainText } from './email-plain-text';
import { runEmailPreflight } from './email-preflight';
import { sanitizeEmailHtml, validateEmailUrl } from './email-security';

function fixture(overrides: Partial<EmailDocumentIr> = {}): EmailDocumentIr {
  return {
    version: '1.0',
    settings: {
      language: 'en',
      direction: 'ltr',
      contentWidth: 600,
      mobileBreakpoint: 480,
      compatibilityProfile: 'modern',
      provider: 'generic',
    },
    nodes: [],
    plainText: '',
    assets: [],
    warnings: [],
    diagnostics: [],
    ...overrides,
  };
}

describe('email security', () => {
  it('rejects executable and local URL schemes', () => {
    expect(validateEmailUrl({ kind: 'web', url: 'javascript:alert(1)' }).valid).toBe(false);
    expect(validateEmailUrl({ kind: 'web', url: 'file:///tmp/a.png' }).valid).toBe(false);
    expect(validateEmailUrl({ kind: 'web', url: 'https://example.com/path' }).valid).toBe(true);
  });

  it('sanitizes tags, event handlers, and unsafe styles', () => {
    const result = sanitizeEmailHtml(
      '<script>alert(1)</script><p onclick="alert(1)" style="color:red;position:absolute">Hi</p><iframe src="x"></iframe>',
    );
    expect(result.html).toContain('<p');
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('onclick');
    expect(result.html).not.toContain('<iframe');
    expect(result.removed.length).toBeGreaterThan(0);
  });
});

describe('email output', () => {
  it('emits safe linked content and plain text', () => {
    const ir = fixture({
      nodes: [
        {
          id: 'email-text',
          sourceNodeId: 'text-1',
          kind: 'paragraph',
          name: 'Body',
          children: [],
          styles: { color: '#111111' },
          content: { type: 'text', text: 'Read this' },
          link: { kind: 'web', url: 'https://example.com', title: 'Read more' },
          compatibility: 'native',
        },
      ],
    });
    const output = emitEmailHtml(ir);
    expect(output.html).toContain('href="https://example.com/"');
    expect(output.html).not.toContain('<script');
    expect(emitEmailPlainText({ ...ir, plainText: '' })).toContain(
      'Read this (https://example.com)',
    );
  });

  it('preflights missing alt text and invalid links', () => {
    const ir = fixture({
      nodes: [
        {
          id: 'email-image',
          sourceNodeId: 'image-1',
          kind: 'image',
          name: 'Hero',
          children: [],
          styles: {},
          image: { src: 'assets/hero.png', alt: '', decorative: false },
          compatibility: 'native',
          link: { kind: 'web', url: 'javascript:bad' },
        },
      ],
    });
    const diagnostics = runEmailPreflight(ir);
    expect(diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['MISSING_IMAGE_ALT', 'INVALID_LINK']),
    );
  });
});
