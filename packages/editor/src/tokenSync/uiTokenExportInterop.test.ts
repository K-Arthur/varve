/**
 * Interop check: Varve's application-token DTCG export must be accepted by
 * the strict DTCG 2025.10 parser, and must not carry any `$`-property the
 * published format does not define.
 *
 * This is deliberately a cross-package test — it lives where both
 * `@varve/ui` (the exporter) and `@varve/tokens` (the strict parser) are
 * available. The allowed-property sets below mirror the published 2025.10
 * format report §5.2 / §6.3 (and the official 2025.10 JSON Schema's
 * `additionalProperties: false` lists); they are a conformance fixture, not
 * a substitute for an independent validator.
 */

import { parseFormatDocument } from '@varve/tokens';
import { dtcgExport } from '@varve/ui/tokens';
import { describe, expect, it } from 'vitest';

const ALLOWED_DOCUMENT_PROPERTIES = new Set(['$description', '$type', '$extensions']);
const ALLOWED_GROUP_PROPERTIES = new Set([
  '$type',
  '$description',
  '$extends',
  '$deprecated',
  '$extensions',
  '$root',
]);
const ALLOWED_TOKEN_PROPERTIES = new Set([
  '$value',
  '$type',
  '$description',
  '$deprecated',
  '$extensions',
  '$ref',
]);

function walk(node: unknown, path: string[], violations: string[]): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  const record = node as Record<string, unknown>;
  const isToken = '$value' in record || '$ref' in record;
  const allowed =
    path.length === 0
      ? ALLOWED_DOCUMENT_PROPERTIES
      : isToken
        ? ALLOWED_TOKEN_PROPERTIES
        : ALLOWED_GROUP_PROPERTIES;
  for (const key of Object.keys(record)) {
    if (!key.startsWith('$')) continue;
    if (!allowed.has(key)) violations.push(`${path.join('.') || '<root>'}: ${key}`);
  }
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('$')) continue;
    walk(value, [...path, key], violations);
  }
}

describe('application token DTCG export interoperability', () => {
  const text = JSON.stringify(dtcgExport(), null, 2);

  it('parses clean under the strict DTCG 2025.10 parser', () => {
    const document = parseFormatDocument(text, { sourceFileId: 'tokens.dtcg.json' });
    const errors = document.diagnostics.filter((d) => d.severity === 'error');
    const warnings = document.diagnostics.filter((d) => d.severity === 'warning');
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(Object.keys(document.tokens).length).toBeGreaterThan(100);
  });

  it('uses only $ properties defined by the 2025.10 format report', () => {
    const violations: string[] = [];
    walk(JSON.parse(text), [], violations);
    expect(violations).toEqual([]);
  });

  it('carries no timestamp or random id that would change an unchanged export', () => {
    expect(JSON.stringify(dtcgExport())).toBe(JSON.stringify(dtcgExport()));
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(text).not.toMatch(/"generated"/);
  });

  it('declares every token with a resolvable type', () => {
    const document = parseFormatDocument(text, { sourceFileId: 'tokens.dtcg.json' });
    for (const token of Object.values(document.tokens)) {
      expect(token.type).toBe('color');
    }
  });
});
