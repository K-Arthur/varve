import { describe, expect, it } from 'vitest';
import type { PortableProjectPath } from './portablePath';
import {
  joinPortableProjectPath,
  portableProjectBasename,
  portableProjectPath,
  validatePortableProjectPath,
} from './portablePath';

describe('portable project paths', () => {
  it('accepts canonical logical paths without host parsing', () => {
    const artworkMark = String.fromCodePoint(0x1f3a8);
    const path = portableProjectPath(`assets/设计 ${artworkMark}/cover.png`);
    expect(portableProjectBasename(path)).toBe('cover.png');
    expect(
      joinPortableProjectPath(`assets/设计 ${artworkMark}` as PortableProjectPath, 'cover.png'),
    ).toBe(path);
  });

  it.each([
    ['/absolute/file.png', 'absolute'],
    ['C:/absolute/file.png', 'drive-prefix'],
    ['//server/share/file.png', 'unc-prefix'],
    ['..\\outside.png', 'invalid-separator'],
    ['assets/../outside.png', 'traversal'],
    ['assets/./file.png', 'traversal'],
    ['file:///etc/passwd', 'invalid-character'],
    ['assets/file:name.png', 'invalid-character'],
  ] as const)('rejects %s as %s', (input, code) => {
    expect(validatePortableProjectPath(input)).toEqual({ ok: false, code });
  });

  it('does not decode URL escapes while validating logical names', () => {
    expect(validatePortableProjectPath('assets/%2e%2e/reference.png').ok).toBe(true);
  });
});
