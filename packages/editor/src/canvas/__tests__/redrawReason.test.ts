import { describe, expect, it } from 'vitest';
import { resolveFullRedrawReason, resolveRedrawReason } from '../dirtyRegion';

describe('resolveRedrawReason', () => {
  const base = {
    docChanged: false,
    dirtyKind: 'none' as const,
    cameraChanged: false,
    imageCacheStampChanged: false,
    fontLoadStampChanged: false,
    variableOnlyChange: false,
  };

  it('attributes document partial edits to geometry-change', () => {
    expect(resolveRedrawReason({ ...base, docChanged: true, dirtyKind: 'partial' })).toBe(
      'geometry-change',
    );
  });

  it('attributes document structural changes to structural-change', () => {
    expect(resolveRedrawReason({ ...base, docChanged: true, dirtyKind: 'full' })).toBe(
      'structural-change',
    );
  });

  it('attributes variable-only document changes to variable-change', () => {
    expect(
      resolveRedrawReason({
        ...base,
        docChanged: true,
        dirtyKind: 'partial',
        variableOnlyChange: true,
      }),
    ).toBe('variable-change');
  });

  it('attributes a clean document with a moving camera to camera-change', () => {
    expect(resolveRedrawReason({ ...base, cameraChanged: true })).toBe('camera-change');
  });

  it('attributes image decode stamps to image-decode', () => {
    expect(resolveRedrawReason({ ...base, imageCacheStampChanged: true })).toBe('image-decode');
  });

  it('attributes font load stamps to font-load', () => {
    expect(resolveRedrawReason({ ...base, fontLoadStampChanged: true })).toBe('font-load');
  });

  it('falls back to clean for an un-caused present', () => {
    expect(resolveRedrawReason(base)).toBe('clean');
  });

  it('document changes win over camera movement', () => {
    expect(
      resolveRedrawReason({ ...base, docChanged: true, dirtyKind: 'partial', cameraChanged: true }),
    ).toBe('geometry-change');
  });
});

describe('resolveFullRedrawReason', () => {
  const base = {
    rotation: 0,
    profileEnablePartialRedraw: true,
    dirtyRectArea: 100,
    viewportArea: 1000,
    hasDirtyRect: true,
  };

  it('returns null when partial redraw is viable', () => {
    expect(resolveFullRedrawReason(base)).toBeNull();
  });

  it('attributes rotation fallback', () => {
    expect(resolveFullRedrawReason({ ...base, rotation: 15 })).toBe('camera-rotation');
  });

  it('attributes profile-disabled fallback', () => {
    expect(resolveFullRedrawReason({ ...base, profileEnablePartialRedraw: false })).toBe(
      'profile-disabled',
    );
  });

  it('attributes dirty-area-limit fallback', () => {
    expect(resolveFullRedrawReason({ ...base, dirtyRectArea: 700 })).toBe('dirty-area-limit');
  });

  it('attributes missing dirty rect', () => {
    expect(resolveFullRedrawReason({ ...base, hasDirtyRect: false })).toBe('no-dirty-rect');
  });
});
