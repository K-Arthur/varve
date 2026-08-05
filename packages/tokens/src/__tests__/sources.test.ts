/**
 * Local sources tests: discovery, glob matching, multi-file merge, atomic
 * write planner failure paths, watcher event coalescing, sync apply.
 */

import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { executeAtomicWrites, type FileSystemIo } from '../atomicWrite';
import { detectTokenFiles, globMatch, mergeTokenFiles } from '../sources';
import {
  createWatcherState,
  flushWatcher,
  pauseWatcher,
  reduceWatcherEvent,
  resumeWatcher,
  shouldProcessContent,
} from '../watcherEvents';

describe('source discovery', () => {
  it('detects token files and applies include/exclude', () => {
    const files = [
      'a.tokens.json',
      'b.tokens',
      'c.resolver.json',
      'd.json',
      'notes.md',
      'e.tokens.json',
    ];
    const { candidates, skipped } = detectTokenFiles(files, {
      exclude: ['e.tokens.json'],
      include: ['*.tokens*', '*.resolver.json'],
    });
    expect(candidates).toEqual(['a.tokens.json', 'b.tokens', 'c.resolver.json']);
    expect(skipped).toEqual(['e.tokens.json']);
  });

  it('does not auto-import every JSON file', () => {
    const { candidates } = detectTokenFiles([
      'package.json',
      'tsconfig.json',
      'tokens.json',
      'design-tokens.json',
      'settings.tokens.json',
    ]);
    expect(candidates).toEqual(['tokens.json', 'design-tokens.json', 'settings.tokens.json']);
    // Explicit entry files always qualify, even with generic names.
    const explicit = detectTokenFiles(['data/config.json'], { entryFiles: ['data/config.json'] });
    expect(explicit.candidates).toEqual(['data/config.json']);
  });

  it('globMatch supports * and ** segments', () => {
    expect(globMatch('tokens/*.json', 'tokens/color.json')).toBe(true);
    expect(globMatch('tokens/*.json', 'tokens/sub/color.json')).toBe(false);
    expect(globMatch('tokens/**/*.json', 'tokens/sub/color.json')).toBe(true);
    expect(globMatch('tokens/**/*.json', 'tokens/color.json')).toBe(true);
    expect(globMatch('*.tokens', 'x.tokens')).toBe(true);
    expect(globMatch('*.tokens', 'x.tokens.json')).toBe(false);
  });
});

describe('multi-file merge', () => {
  it('merges files last-wins in entry order', () => {
    const { document, diagnostics } = mergeTokenFiles([
      { fileId: 'a.json', text: '{"color": {"brand": {"$type": "color", "$value": "#111111"}}}' },
      {
        fileId: 'b.json',
        text: '{"color": {"brand": {"$type": "color", "$value": "#222222"}}, "spacing": {"$type": "dimension", "$value": {"value": 8, "unit": "px"}}}',
      },
    ]);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(document.tokens['color.brand']?.value).toBe('#222222');
    expect(document.tokens['spacing']?.value).toEqual({ value: 8, unit: 'px' });
  });

  it('reports per-file errors and skips broken files', () => {
    const { document, diagnostics, parsedFiles } = mergeTokenFiles([
      { fileId: 'bad.json', text: '{broken' },
      { fileId: 'good.json', text: '{"a": {"$type": "number", "$value": 1}}' },
    ]);
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(parsedFiles).toEqual(['good.json']);
    expect(document.tokens['a']).toBeDefined();
  });
});

describe('atomic writes', () => {
  function memoryIo(
    initial: Record<string, string> = {},
  ): FileSystemIo & { files: Record<string, string> } {
    const files: Record<string, string> = { ...initial };
    return {
      files,
      exists: (p) => p in files,
      read: (p) => files[p] ?? '',
      write: (p, c) => {
        files[p] = c;
      },
      rename: (from, to) => {
        files[to] = files[from] ?? '';
        delete files[from];
      },
      remove: (p) => {
        delete files[p];
      },
      hash: (c) => {
        let h = 0;
        for (let i = 0; i < c.length; i += 1) h = (h * 31 + c.charCodeAt(i)) | 0;
        return String(h);
      },
      validate: (c) =>
        c.trim().length > 0 ? { ok: true } : { ok: false, message: 'empty content' },
    };
  }

  it('writes temp files, verifies read-back, and renames atomically', () => {
    const io = memoryIo({ 'tokens.json': '{}' });
    const manifest = executeAtomicWrites(io, [{ targetPath: 'tokens.json', content: '{"a": 1}' }]);
    expect(manifest.complete).toBe(true);
    expect(io.files['tokens.json']).toBe('{"a": 1}');
    expect(Object.keys(io.files).some((p) => p.includes('.tmp-'))).toBe(false);
    expect(manifest.files[0]?.status).toBe('replaced');
  });

  it('aborts before touching targets when content is invalid', () => {
    const io = memoryIo({ 'tokens.json': '{}' });
    const manifest = executeAtomicWrites(io, [{ targetPath: 'tokens.json', content: '' }]);
    expect(manifest.complete).toBe(false);
    expect(io.files['tokens.json']).toBe('{}');
    expect(manifest.diagnostics.some((d) => d.code === 'write.invalid-content')).toBe(true);
  });

  it('detects targets that changed after preview', () => {
    const io = memoryIo({ 'tokens.json': '{"remote": true}' });
    const manifest = executeAtomicWrites(
      io,
      [{ targetPath: 'tokens.json', content: '{"local": true}', expectedTargetHash: 'old-hash' }],
      { verifyTargetHash: true },
    );
    expect(manifest.complete).toBe(false);
    expect(io.files['tokens.json']).toBe('{"remote": true}');
    expect(manifest.diagnostics.some((d) => d.code === 'write.target-changed')).toBe(true);
  });

  it('never marks the source clean on partial multi-file failure', () => {
    const io = memoryIo({ a: '{}', b: '{}' });
    const originalRename = io.rename.bind(io);
    let failOnB = true;
    io.rename = (from, to) => {
      if (failOnB && to === 'b') {
        failOnB = false;
        throw new Error('permission denied');
      }
      originalRename(from, to);
    };
    const manifest = executeAtomicWrites(io, [
      { targetPath: 'a', content: '{"x": 1}' },
      { targetPath: 'b', content: '{"y": 2}' },
    ]);
    expect(manifest.complete).toBe(false);
    const statuses = manifest.files.map((f) => `${f.path}:${f.status}`).sort();
    expect(statuses).toEqual(['a:replaced', 'b:failed']);
  });

  it('keeps recoverable backups when configured', () => {
    const io = memoryIo({ 'tokens.json': '{"old": 1}' });
    executeAtomicWrites(io, [{ targetPath: 'tokens.json', content: '{"new": 1}' }], {
      keepBackups: true,
    });
    expect(io.files['tokens.json.bak']).toBe('{"old": 1}');
  });
});

describe('watcher events', () => {
  it('coalesces bursts into one logical event per path', () => {
    let state = createWatcherState(200);
    let due: unknown[] = [];
    for (let i = 0; i < 10; i += 1) {
      const r = reduceWatcherEvent(
        state,
        { kind: 'modified', path: 'tokens.json', at: i * 10 },
        i * 10,
      );
      state = r.state;
      due = due.concat(r.due);
    }
    expect(due.length).toBe(0); // all pending within the debounce window
    const flushed = flushWatcher(state);
    expect(flushed.flush.events).toHaveLength(1);
    expect(flushed.flush.events[0]?.path).toBe('tokens.json');
  });

  it('ignores self-writes', () => {
    const state = createWatcherState(1);
    const r = reduceWatcherEvent(
      state,
      { kind: 'modified', path: 'tokens.json', at: 0, selfWrite: true },
      0,
    );
    expect(r.state.lastSeq).toBe(0);
  });

  it('pauses and resumes without losing state', () => {
    let state = pauseWatcher(createWatcherState(1), 'conflict-write');
    const r = reduceWatcherEvent(state, { kind: 'modified', path: 'tokens.json', at: 0 }, 0);
    expect(r.due).toEqual([]);
    state = resumeWatcher(r.state);
    expect(state.paused).toBe(false);
    const r2 = reduceWatcherEvent(state, { kind: 'modified', path: 'tokens.json', at: 0 }, 1);
    expect(r2.due).toHaveLength(1);
  });

  it('suppresses formatting-only changes via content hashes', () => {
    let state = createWatcherState(1);
    const first = shouldProcessContent(state, 'tokens.json', 'hash-a');
    state = first.state;
    expect(first.changed).toBe(true);
    const second = shouldProcessContent(state, 'tokens.json', 'hash-a');
    expect(second.changed).toBe(false);
    const third = shouldProcessContent(second.state, 'tokens.json', 'hash-b');
    expect(third.changed).toBe(true);
  });
});

describe('real filesystem atomic writes', () => {
  it('writes and replaces a real file atomically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'varve-tokens-'));
    try {
      const target = join(dir, 'tokens.json');
      writeFileSync(target, '{"old": 1}');
      const io: FileSystemIo = {
        exists: (p) => existsSync(p),
        read: (p) => readFileSync(p, 'utf8'),
        write: (p, c) => writeFileSync(p, c),
        rename: (from, to) => renameSync(from, to),
        remove: (p) => {
          if (existsSync(p)) rmSync(p);
        },
        hash: (c) => String(c.length),
        validate: (c) => (c.trim().length > 0 ? { ok: true } : { ok: false, message: 'empty' }),
      };
      const manifest = executeAtomicWrites(io, [{ targetPath: target, content: '{"new": 2}' }]);
      expect(manifest.complete).toBe(true);
      expect(readFileSync(target, 'utf8')).toBe('{"new": 2}');
      // no temp leftovers
      const leftovers = (() => {
        const fs = require('fs') as typeof import('fs');
        return fs.readdirSync(dir).filter((f) => f.includes('.tmp-'));
      })();
      expect(leftovers).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
