import { describe, expect, it } from 'vitest';
import { optimizeSwiftUI } from './swiftui';

describe('swiftui optimizer', () => {
  it('merges consecutive modifiers', () => {
    const input = `.foregroundColor(.blue)
  .font(.title)`;
    const result = optimizeSwiftUI(input);
    expect(result).not.toBeNull();
    expect(result).toContain('.foregroundColor(.blue).font(.title)');
  });

  it('removes redundant .frame()', () => {
    const input = `Text("hello")
  .frame()`;
    const result = optimizeSwiftUI(input);
    expect(result).not.toBeNull();
    expect(result).not.toContain('.frame()');
  });

  it('simplifies .padding(.all, N) to .padding(N)', () => {
    const input = `.padding(.all, 16)`;
    const result = optimizeSwiftUI(input);
    expect(result).not.toBeNull();
    expect(result).toContain('.padding(16)');
  });

  it('returns null when no rules apply', () => {
    const result = optimizeSwiftUI('Text("hello")');
    expect(result).toBeNull();
  });
});
