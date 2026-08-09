import { describe, expect, it } from 'vitest';
import {
  classifyTauriSaveError,
  directoryOfPath,
  displayNameFromPath,
  normalizeSaveFileName,
} from '../pure';

describe('normalizeSaveFileName', () => {
  it('appends .varve to a bare name', () => {
    expect(normalizeSaveFileName('Poster')).toBe('Poster.varve');
  });

  it('never stacks a second extension', () => {
    expect(normalizeSaveFileName('Poster.varve')).toBe('Poster.varve');
    expect(normalizeSaveFileName('Poster.strata')).toBe('Poster.strata');
  });

  it('strips path separators and control characters', () => {
    expect(normalizeSaveFileName('a/b/c')).toBe('a b c.varve');
    expect(normalizeSaveFileName('a\\b')).toBe('a b.varve');
    expect(normalizeSaveFileName('bad\u0000name')).toBe('badname.varve');
  });

  it('falls back to Untitled for empty or dot names', () => {
    expect(normalizeSaveFileName('   ')).toBe('Untitled.varve');
    expect(normalizeSaveFileName('.')).toBe('Untitled.varve');
    expect(normalizeSaveFileName('..')).toBe('Untitled.varve');
  });

  it('keeps Unicode and RTL names intact', () => {
    expect(normalizeSaveFileName('中文海报')).toBe('中文海报.varve');
    expect(normalizeSaveFileName('ملصق')).toBe('ملصق.varve');
  });
});

describe('displayNameFromPath', () => {
  it('extracts the basename without extension', () => {
    expect(displayNameFromPath('/home/user/Docs/Poster.varve')).toBe('Poster');
    expect(displayNameFromPath('C:\\Users\\me\\Desktop\\Poster.varve')).toBe('Poster');
    expect(displayNameFromPath('/tmp/no-ext')).toBe('no-ext');
  });
});

describe('directoryOfPath', () => {
  it('returns the parent directory', () => {
    expect(directoryOfPath('/home/user/Docs/Poster.varve')).toBe('/home/user/Docs');
    expect(directoryOfPath('C:\\Users\\me\\Desktop\\Poster.varve')).toBe('C:\\Users\\me\\Desktop');
  });

  it('returns null for root-level paths', () => {
    expect(directoryOfPath('/Poster.varve')).toBeNull();
  });
});

describe('classifyTauriSaveError', () => {
  it('classifies permission errors', () => {
    const e = classifyTauriSaveError('Permission denied (os error 13)');
    expect(e.category).toBe('permission-denied');
  });

  it('classifies disk-full errors', () => {
    expect(classifyTauriSaveError('No space left on device (os error 28)').category).toBe(
      'disk-full',
    );
  });

  it('classifies read-only volumes', () => {
    expect(classifyTauriSaveError('Read-only file system (os error 30)').category).toBe(
      'read-only',
    );
  });

  it('classifies missing destinations', () => {
    expect(classifyTauriSaveError('No such file or directory (os error 2)').category).toBe(
      'destination-missing',
    );
  });

  it('falls back to unknown-io', () => {
    expect(classifyTauriSaveError('Something strange happened').category).toBe('unknown-io');
  });
});
