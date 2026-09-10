import { describe, expect, it } from 'vitest';
import { optimizeFlutter } from './flutter';

describe('flutter optimizer', () => {
  it('merges Positioned + Container into Positioned.fill', () => {
    const input = `Positioned(
  top: 10,
  left: 20,
  child: Container(
    color: Colors.blue,
    child: Text('hi'),
  ),
)`;
    const result = optimizeFlutter(input);
    expect(result).not.toBeNull();
    expect(result).toContain('Positioned.fill');
  });

  it('replaces Container(color:) with ColoredBox when no other props', () => {
    const input = `Container(
  color: Colors.blue,
  child: Text('hi'),
)`;
    const result = optimizeFlutter(input);
    expect(result).not.toBeNull();
    expect(result).toContain('ColoredBox');
  });

  it('replaces SizedBox(0,0) with SizedBox.shrink()', () => {
    const input = `SizedBox(
  width: 0,
  height: 0,
)`;
    const result = optimizeFlutter(input);
    expect(result).not.toBeNull();
    expect(result).toContain('SizedBox.shrink()');
  });

  it('returns null when no rules apply (empty code)', () => {
    const result = optimizeFlutter('');
    expect(result).toBeNull();
  });

  it('returns null when code is already optimal', () => {
    const result = optimizeFlutter('SizedBox.shrink()');
    expect(result).toBeNull();
  });
});
