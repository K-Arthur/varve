/**
 * CLI command tests (M13, M14): argument parsing, diff formatting, merge
 * driver contract, and review bundle generation.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffDocuments } from '@varve/history';
import type { Document } from '@varve/scene';
import {
  canonicalizeDocument,
  createDocument,
  DocumentCodec,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatDiff,
  GIT_ATTRIBUTES_LINE,
  GIT_CONFIG_LINES,
  gitSetupInstructions,
  loadDocumentFile,
  parseArgs,
  runCanonicalize,
  runMergeDriver,
  runValidate,
} from '../cli';
import { buildReviewBundle, buildSummaryMarkdown, buildViewerHtml } from '../review';

const TEMP_DIRS: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'varve-cli-test-'));
  TEMP_DIRS.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of TEMP_DIRS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function baseDoc(name = 'Base'): Document {
  const doc = { ...createDocument(name, { flat: true }), id: 'cli-doc-001' } as Document;
  const rect = makeShapeNode(
    'n1_aaaa',
    { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    { name: 'Button' },
  );
  const frame = makeFrameNode('n2_bbbb', { name: 'Group', children: ['n1_aaaa'] });
  doc.nodes = { [rect.id]: rect, [frame.id]: frame };
  doc.rootChildren = ['n2_bbbb'];
  return doc;
}

function clone(doc: Document): Document {
  return structuredClone(doc);
}

function writeDoc(dir: string, name: string, doc: Document): string {
  const path = join(dir, name);
  writeFileSync(path, DocumentCodec.encode(doc), 'utf8');
  return path;
}

describe('parseArgs', () => {
  it('separates positional args and options', () => {
    const parsed = parseArgs(['diff', 'base.varve', 'target.varve', '--format', 'json']);
    expect(parsed.name).toBe('diff');
    expect(parsed.args).toEqual(['base.varve', 'target.varve']);
    expect(parsed.options.format).toBe('json');
  });

  it('supports --opt=value syntax', () => {
    const parsed = parseArgs(['review', 'a', 'b', '--output=dir']);
    expect(parsed.options.output).toBe('dir');
  });

  it('supports boolean flags', () => {
    const parsed = parseArgs(['canonicalize', 'f', '--hash']);
    expect(parsed.options.hash).toBe(true);
  });
});

describe('loadDocumentFile / runValidate', () => {
  it('loads and validates a document', () => {
    const dir = tempDir();
    const path = writeDoc(dir, 'a.varve', baseDoc());
    const loaded = loadDocumentFile(path);
    expect(loaded.document.name).toBe('Base');
    const result = runValidate(path);
    expect(result.nodeCount).toBe(2);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects invalid documents', () => {
    const dir = tempDir();
    const path = join(dir, 'bad.varve');
    writeFileSync(path, '{ not json', 'utf8');
    expect(() => loadDocumentFile(path)).toThrow(/invalid document/);
  });
});

describe('runCanonicalize', () => {
  it('prints canonical JSON and hashes deterministically', () => {
    const dir = tempDir();
    const path = writeDoc(dir, 'a.varve', baseDoc());
    const canonical = runCanonicalize(path);
    expect(canonical).toContain('"name":"Base"');
    const hash1 = runCanonicalize(path, { hash: true });
    const hash2 = runCanonicalize(path, { hash: true });
    expect(hash1).toBe(hash2);
  });
});

describe('formatDiff', () => {
  it('formats a text diff', () => {
    const base = baseDoc();
    const target = clone(base);
    (target.nodes.n1_aaaa as { opacity: number }).opacity = 0.5;
    const diff = diffDocuments(base, target);
    const text = formatDiff(diff, 'text');
    expect(text).toContain('[modified]');
    expect(text).toContain('opacity');
  });

  it('formats a summary', () => {
    const base = baseDoc();
    const target = clone(base);
    (target.nodes.n1_aaaa as { opacity: number }).opacity = 0.5;
    const text = formatDiff(diffDocuments(base, target), 'summary');
    expect(text).toContain('CHANGED: 1 change(s)');
  });
});

describe('runMergeDriver', () => {
  it('writes the merged document into the current path (clean merge)', () => {
    const dir = tempDir();
    const base = baseDoc();
    const ours = clone(base);
    (ours.nodes.n1_aaaa as { opacity: number }).opacity = 0.4;
    const theirs = clone(base);
    (theirs.nodes.n2_bbbb as { name: string }).name = 'Group 2';
    const basePath = writeDoc(dir, 'base.varve', base);
    const currentPath = writeDoc(dir, 'current.varve', ours);
    const incomingPath = writeDoc(dir, 'incoming.varve', theirs);
    const manifestPath = join(dir, 'manifest.json');

    const result = runMergeDriver(basePath, currentPath, incomingPath, { manifestPath });
    expect(result.status).toBe('clean');
    expect(result.exitCode).toBe(0);

    const merged = DocumentCodec.decode(readFileSync(currentPath, 'utf8'));
    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect((merged.document.nodes.n1_aaaa as { opacity: number }).opacity).toBe(0.4);
      expect((merged.document.nodes.n2_bbbb as { name: string }).name).toBe('Group 2');
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.schema).toBe('varve-merge-manifest/1');
    expect(manifest.status).toBe('clean');
  });

  it('reports conflicts and exits 1', () => {
    const dir = tempDir();
    const base = baseDoc();
    const ours = clone(base);
    (ours.nodes.n1_aaaa as { opacity: number }).opacity = 0.4;
    const theirs = clone(base);
    (theirs.nodes.n1_aaaa as { opacity: number }).opacity = 0.6;
    const basePath = writeDoc(dir, 'base.varve', base);
    const currentPath = writeDoc(dir, 'current.varve', ours);
    const incomingPath = writeDoc(dir, 'incoming.varve', theirs);
    const result = runMergeDriver(basePath, currentPath, incomingPath);
    expect(result.status).toBe('conflicted');
    expect(result.exitCode).toBe(1);
    expect(result.conflictCount).toBe(1);
    const manifest = JSON.parse(readFileSync(`${currentPath}.conflicts.json`, 'utf8'));
    expect(manifest.conflicts[0].conflictKind).toBe('scalar');
  });

  it('round-trips through the canonical format', () => {
    const dir = tempDir();
    const base = baseDoc();
    const ours = clone(base);
    const theirs = clone(base);
    (theirs.nodes.n1_aaaa as { opacity: number }).opacity = 0.25;
    const basePath = writeDoc(dir, 'base.varve', base);
    const currentPath = writeDoc(dir, 'current.varve', ours);
    const incomingPath = writeDoc(dir, 'incoming.varve', theirs);
    runMergeDriver(basePath, currentPath, incomingPath);
    const roundTrip = DocumentCodec.decode(readFileSync(currentPath, 'utf8'));
    expect(roundTrip.ok).toBe(true);
  });
});

describe('review bundle', () => {
  it('generates all four files', () => {
    const dir = tempDir();
    const base = baseDoc();
    const target = clone(base);
    (target.nodes.n1_aaaa as { opacity: number }).opacity = 0.5;
    (target.nodes.n2_bbbb as { name: string }).name = 'Renamed';
    const { files, changeCount } = buildReviewBundle(base, target, dir);
    expect(files).toEqual(['manifest.json', 'diff.json', 'summary.md', 'index.html']);
    expect(changeCount).toBeGreaterThan(0);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.schema).toBe('varve-review-bundle/1');
    expect(manifest.changeCount).toBe(changeCount);
  });

  it('marks unchanged bundles', () => {
    const dir = tempDir();
    const base = baseDoc();
    const { changeCount } = buildReviewBundle(base, clone(base), dir);
    expect(changeCount).toBe(0);
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(html).toContain('No semantic changes');
  });

  it('summary markdown lists every change', () => {
    const base = baseDoc();
    const target = clone(base);
    (target.nodes.n1_aaaa as { opacity: number }).opacity = 0.5;
    const markdown = buildSummaryMarkdown(diffDocuments(base, target));
    expect(markdown).toContain('nodes.n1_aaaa.opacity');
  });

  it('viewer HTML is standalone and escaped', () => {
    const base = baseDoc();
    const target = clone(base);
    (target.nodes.n1_aaaa as { name: string }).name = 'A <script>alert(1)</script> button';
    const html = buildViewerHtml(diffDocuments(base, target));
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('aria-labelledby');
  });
});

describe('git integration docs', () => {
  it('git-setup instructions are complete', () => {
    const text = gitSetupInstructions();
    expect(text).toContain(GIT_ATTRIBUTES_LINE);
    for (const line of GIT_CONFIG_LINES) expect(text).toContain(line);
  });

  it('canonical output is stable across codec round trips (nextId is runtime-derived)', () => {
    const doc = baseDoc();
    const encoded = DocumentCodec.encode(doc);
    const decoded = DocumentCodec.decode(encoded);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      const normalized = (value: Document): Document => ({ ...value, nextId: 1 });
      expect(canonicalizeDocument(normalized(decoded.document))).toBe(
        canonicalizeDocument(normalized(doc)),
      );
    }
  });
});

describe('headless smoke tests (M17)', () => {
  it('rejects missing files with a clear error', () => {
    const dir = tempDir();
    expect(() => loadDocumentFile(join(dir, 'missing.varve'))).toThrow(
      /no such file|ENOENT|invalid document/,
    );
  });

  it('merge driver returns error exit code 2 for a missing base file', () => {
    const dir = tempDir();
    const ours = writeDoc(dir, 'ours.varve', baseDoc());
    const theirs = writeDoc(dir, 'theirs.varve', baseDoc());
    let caught: unknown;
    try {
      runMergeDriver(join(dir, 'missing-base.varve'), ours, theirs);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as { exitCode?: number }).exitCode).toBe(2);
  });

  it('merge driver handles file paths containing spaces and unicode', () => {
    const dir = tempDir();
    const sub = join(dir, 'my design ü');
    mkdirSync(sub, { recursive: true });
    const basePath = writeDoc(sub, 'base file.varve', baseDoc());
    const ours = clone(baseDoc());
    (ours.nodes.n1_aaaa as { opacity: number }).opacity = 0.4;
    const currentPath = writeDoc(sub, 'current file.varve', ours);
    const theirs = clone(baseDoc());
    (theirs.nodes.n2_bbbb as { name: string }).name = 'Renamed';
    const incomingPath = writeDoc(sub, 'incoming file.varve', theirs);
    const result = runMergeDriver(basePath, currentPath, incomingPath);
    expect(result.status).toBe('clean');
    expect(result.exitCode).toBe(0);
  });

  it('textconv output is canonical JSON with no volatile fields', () => {
    const dir = tempDir();
    const path = writeDoc(dir, 'a.varve', baseDoc());
    const canonical = runCanonicalize(path);
    // Canonical serialization excludes runtime counters and volatile state.
    expect(canonical).toContain('"name":"Base"');
    expect(canonical).not.toContain('dataUrl');
  });

  it('review bundles are reproducible (byte-identical across runs)', () => {
    const dir = tempDir();
    const base = baseDoc();
    const target = clone(base);
    (target.nodes.n1_aaaa as { opacity: number }).opacity = 0.5;
    const out1 = join(dir, 'r1');
    const out2 = join(dir, 'r2');
    mkdirSync(out1, { recursive: true });
    mkdirSync(out2, { recursive: true });
    const { files: f1 } = buildReviewBundle(base, target, out1);
    const { files: f2 } = buildReviewBundle(base, target, out2);
    expect(f1).toEqual(f2);
    for (const file of f1) {
      expect(readFileSync(join(out1, file), 'utf8')).toBe(readFileSync(join(out2, file), 'utf8'));
    }
  });

  it('review bundle marks structural integrity and schema versions', () => {
    const dir = tempDir();
    const base = baseDoc();
    const target = clone(base);
    (target.nodes.n1_aaaa as { opacity: number }).opacity = 0.5;
    buildReviewBundle(base, target, dir);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.baseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.targetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.schema).toBe('varve-review-bundle/1');
    const diffJson = JSON.parse(readFileSync(join(dir, 'diff.json'), 'utf8'));
    expect(Array.isArray(diffJson.changes)).toBe(true);
    expect(diffJson.baseHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
