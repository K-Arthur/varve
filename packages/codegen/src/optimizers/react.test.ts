import { describe, expect, it } from 'vitest';
import { optimizeReact } from './react';

describe('react optimizer', () => {
  it('removes empty style objects', () => {
    const result = optimizeReact('<div style={{}}>hi</div>');
    expect(result).not.toBeNull();
    expect(result).not.toContain('style={}');
  });

  it('collapses boolean props', () => {
    const result = optimizeReact('<input disabled={true} />');
    expect(result).not.toBeNull();
    expect(result).toContain('disabled');
    expect(result).not.toContain('={true}');
  });

  it('self-closes empty tags', () => {
    const result = optimizeReact('<div className="box"></div>');
    expect(result).not.toBeNull();
    expect(result).toContain('/>');
  });

  it('returns null when no rules apply', () => {
    const result = optimizeReact('<div>content</div>');
    expect(result).toBeNull();
  });
});
