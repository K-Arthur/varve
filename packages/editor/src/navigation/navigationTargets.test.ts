import { describe, expect, it } from 'vitest';
import {
  normalizeNavigationTarget,
  parseNavigationTarget,
  parseNavigationTargetFromUrl,
  serializeNavigationTarget,
} from './navigationTargets';

describe('parseNavigationTarget — canonical varve:// form', () => {
  it('parses a workspace target', () => {
    const r = parseNavigationTarget('varve://navigate/workspace/design');
    expect(r).toEqual({ ok: true, target: { kind: 'workspace', mode: 'design' } });
  });

  it('parses a document target', () => {
    const r = parseNavigationTarget('varve://navigate/document/n12_3fa9c2e4d5b6a718');
    expect(r.ok && r.target).toEqual({
      kind: 'document',
      documentId: 'n12_3fa9c2e4d5b6a718',
    });
  });

  it('parses a page target', () => {
    const r = parseNavigationTarget('varve://navigate/page/p1');
    expect(r.ok && r.target).toEqual({ kind: 'page', pageId: 'p1' });
  });

  it('parses a node target with fit policy', () => {
    expect(parseNavigationTarget('varve://navigate/node/abc/fit')).toEqual({
      ok: true,
      target: { kind: 'node', nodeId: 'abc', fit: true },
    });
    expect(parseNavigationTarget('varve://navigate/node/abc/reveal')).toEqual({
      ok: true,
      target: { kind: 'node', nodeId: 'abc', fit: false },
    });
    expect(parseNavigationTarget('varve://navigate/node/abc')).toEqual({
      ok: true,
      target: { kind: 'node', nodeId: 'abc' },
    });
  });

  it('parses a home target', () => {
    expect(parseNavigationTarget('varve://navigate/home')).toEqual({
      ok: true,
      target: { kind: 'home' },
    });
  });

  it('parses a viewport target with zoom and pan', () => {
    expect(parseNavigationTarget('varve://navigate/viewport/2.5/-100/40')).toEqual({
      ok: true,
      target: { kind: 'viewport', zoom: 2.5, pan: { x: -100, y: 40 } },
    });
    expect(parseNavigationTarget('varve://navigate/viewport/1')).toEqual({
      ok: true,
      target: { kind: 'viewport', zoom: 1, pan: undefined },
    });
  });
});

describe('parseNavigationTarget — legacy and URL forms', () => {
  it('parses legacy finding: links', () => {
    expect(parseNavigationTarget('finding:audit-42')).toEqual({
      ok: true,
      target: { kind: 'finding', findingId: 'audit-42' },
    });
  });

  it('parses legacy ?finding= query links', () => {
    expect(parseNavigationTarget('?finding=audit-42')).toEqual({
      ok: true,
      target: { kind: 'finding', findingId: 'audit-42' },
    });
  });

  it('parses http(s) URLs with query destinations', () => {
    const r = parseNavigationTargetFromUrl('https://varve.app/editor?page=p3&finding=audit-7');
    // First matching kind wins in parameter order: page before finding.
    expect(r.ok && r.target).toEqual({ kind: 'page', pageId: 'p3' });
  });

  it('parses varve: scheme URLs from hrefs', () => {
    expect(parseNavigationTargetFromUrl('varve://navigate/workspace/logo')).toEqual({
      ok: true,
      target: { kind: 'workspace', mode: 'logo' },
    });
  });
});

describe('parseNavigationTarget — hostile and malformed input', () => {
  it('rejects empty input', () => {
    expect(parseNavigationTarget('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseNavigationTarget('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects unknown kinds', () => {
    expect(parseNavigationTarget('varve://navigate/banana/x')).toEqual({
      ok: false,
      reason: 'unknown-kind',
    });
    expect(parseNavigationTarget('?banana=x')).toEqual({ ok: false, reason: 'unknown-kind' });
    expect(parseNavigationTarget('banana:x')).toEqual({ ok: false, reason: 'malformed-url' });
  });

  it('rejects unknown workspace modes', () => {
    expect(parseNavigationTarget('varve://navigate/workspace/paint')).toEqual({
      ok: false,
      reason: 'unknown-workspace',
    });
  });

  it('rejects path-traversal and hostile ids', () => {
    for (const bad of [
      'varve://navigate/node/..',
      'varve://navigate/node/..%2Fetc%2Fpasswd',
      'varve://navigate/node/a b',
      'varve://navigate/document//',
      'varve://navigate/node/%00',
    ]) {
      const r = parseNavigationTarget(bad);
      expect(r.ok).toBe(false);
    }
  });

  it('rejects malformed segment counts', () => {
    expect(parseNavigationTarget('varve://navigate/page')).toEqual({
      ok: false,
      reason: 'bad-segments',
    });
    expect(parseNavigationTarget('varve://navigate/page/a/b')).toEqual({
      ok: false,
      reason: 'bad-segments',
    });
    expect(parseNavigationTarget('varve://navigate/home/extra')).toEqual({
      ok: false,
      reason: 'bad-segments',
    });
    expect(parseNavigationTarget('varve://navigate/node/abc/bogus')).toEqual({
      ok: false,
      reason: 'bad-segments',
    });
    expect(parseNavigationTarget('varve://navigate/viewport/1/2')).toEqual({
      ok: false,
      reason: 'bad-segments',
    });
  });

  it('rejects invalid viewport numbers', () => {
    expect(parseNavigationTarget('varve://navigate/viewport/0')).toEqual({
      ok: false,
      reason: 'invalid-viewport',
    });
    expect(parseNavigationTarget('varve://navigate/viewport/-2')).toEqual({
      ok: false,
      reason: 'invalid-viewport',
    });
    expect(parseNavigationTarget('varve://navigate/viewport/abc')).toEqual({
      ok: false,
      reason: 'invalid-viewport',
    });
  });

  it('rejects malformed URLs', () => {
    expect(parseNavigationTarget('varve://')).toEqual({ ok: false, reason: 'unknown-kind' });
    expect(parseNavigationTarget('not a url at all')).toEqual({
      ok: false,
      reason: 'malformed-url',
    });
  });
});

describe('serialize + round-trip', () => {
  it('round-trips every kind', () => {
    const targets = [
      { kind: 'home' },
      { kind: 'document', documentId: 'd1' },
      { kind: 'workspace', mode: 'motion' },
      { kind: 'page', pageId: 'p9' },
      { kind: 'node', nodeId: 'n5', fit: true },
      { kind: 'node', nodeId: 'n6' },
      { kind: 'finding', findingId: 'f1' },
      { kind: 'viewport', zoom: 3, pan: { x: 10, y: -20 } },
    ] as const;
    for (const t of targets) {
      const serialized = serializeNavigationTarget(t as never);
      const parsed = parseNavigationTarget(serialized);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.target).toEqual(t);
    }
  });

  it('normalizeNavigationTarget returns the same shape as parse', () => {
    const a = normalizeNavigationTarget('varve://navigate/workspace/print');
    const b = parseNavigationTarget('varve://navigate/workspace/print');
    expect(a).toEqual(b);
  });
});
