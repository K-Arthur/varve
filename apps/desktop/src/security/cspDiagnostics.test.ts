/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { __test__ } from './cspDiagnostics';

describe('cspDiagnostics.sanitizeSource', () => {
  it('returns null for empty or null input', () => {
    expect(__test__.sanitizeSource(null)).toBeNull();
    expect(__test__.sanitizeSource('')).toBeNull();
    expect(__test__.sanitizeSource('null')).toBeNull();
  });

  it('masks local file paths', () => {
    expect(__test__.sanitizeSource('file:///home/user/secret.txt')).toBe('[local]');
  });

  it('masks tauri protocol URLs', () => {
    expect(__test__.sanitizeSource('tauri://localhost/assets/secret.png')).toBe('[local]');
  });

  it('masks ipc localhost URLs', () => {
    expect(__test__.sanitizeSource('http://ipc.localhost/some/path')).toBe('[local]');
  });

  it('returns origin for public HTTPS URLs', () => {
    expect(__test__.sanitizeSource('https://example.com/script.js')).toBe(
      'https://example.com/script.js',
    );
  });

  it('truncates long pathnames', () => {
    const longPath = `https://example.com/${'a'.repeat(80)}.js`;
    const result = __test__.sanitizeSource(longPath);
    expect(result).toContain('/…');
    expect(result!.length).toBeLessThan(longPath.length);
  });
});
