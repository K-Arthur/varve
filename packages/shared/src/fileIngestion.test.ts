import { describe, expect, it } from 'vitest';
import {
  fileExtension,
  fileMatchesAccept,
  formatFileSize,
  type IngestFileLike,
  validateFileSelection,
} from './fileIngestion';

function file(name: string, size = 10, type = ''): IngestFileLike {
  return { name, size, type };
}

describe('file ingestion selection rules', () => {
  it('normalizes extensions from paths and mixed case', () => {
    expect(fileExtension('folder\\Artwork.SVG')).toBe('svg');
    expect(fileExtension('README')).toBe('');
  });

  it('matches extension, exact MIME, and MIME wildcard accept tokens', () => {
    expect(fileMatchesAccept(file('art.SVG', 10, 'text/plain'), '.svg')).toBe(true);
    expect(fileMatchesAccept(file('art.bin', 10, 'image/png'), 'image/png')).toBe(true);
    expect(fileMatchesAccept(file('art.webp', 10, 'image/webp'), 'image/*')).toBe(true);
    expect(fileMatchesAccept(file('art.txt', 10, 'text/plain'), 'image/*')).toBe(false);
  });

  it('rejects empty, oversized, and unsupported files while preserving order', () => {
    const result = validateFileSelection(
      [file('empty.png', 0, 'image/png'), file('good.png', 20, 'image/png'), file('bad.txt')],
      { accept: 'image/*', maxSize: 50 },
    );

    expect(result.accepted.map((item) => item.name)).toEqual(['good.png']);
    expect(result.rejected.map((item) => item.code)).toEqual(['empty-file', 'unsupported-type']);
  });

  it('partially accepts a batch over the file count limit', () => {
    const result = validateFileSelection([file('a.svg'), file('b.svg'), file('c.svg')], {
      accept: '.svg',
      maxFiles: 2,
    });

    expect(result.accepted.map((item) => item.name)).toEqual(['a.svg', 'b.svg']);
    expect(result.rejected[0]?.code).toBe('too-many-files');
    expect(result.rejected[0]?.file.name).toBe('c.svg');
  });

  it('limits a single-file selection even when a drop supplies several files', () => {
    const result = validateFileSelection(
      [file('first.png', 1, 'image/png'), file('second.png', 1, 'image/png')],
      { accept: 'image/*', multiple: false },
    );

    expect(result.accepted.map((item) => item.name)).toEqual(['first.png']);
    expect(result.rejected).toMatchObject([
      { file: { name: 'second.png' }, code: 'too-many-files' },
    ]);
  });

  it('does not silently deduplicate same-named files', () => {
    const result = validateFileSelection([file('copy.png', 10), file('copy.png', 11)], {
      accept: '.png',
    });
    expect(result.accepted).toHaveLength(2);
  });

  it('formats byte sizes for queue metadata', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
  });
});
