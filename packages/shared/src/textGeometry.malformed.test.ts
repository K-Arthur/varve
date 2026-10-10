/**
 * Test text geometry robustness for malformed text fields
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveTextGeometry, type TextGeometryInput } from './textGeometry';

describe('textGeometry malformed input handling', () => {
  it('should handle malformed text field gracefully', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Malformed node with Quill Delta instead of string
    const malformedNode: TextGeometryInput = {
      text: { ops: [{ insert: 'Hello' }] } as never, // Wrong format
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: 400,
      fontStyle: 'normal' as const,
      lineHeight: 1.2,
    };

    // Should not throw
    const result = resolveTextGeometry(malformedNode);
    expect(result).toBeDefined();

    // Should have logged a warning
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('has invalid text field'));

    consoleWarnSpy.mockRestore();
  });

  it('should handle string text field normally', () => {
    const node: TextGeometryInput = {
      text: 'Hello\nWorld',
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: 400,
      fontStyle: 'normal' as const,
      lineHeight: 1.2,
    };

    const result = resolveTextGeometry(node);
    expect(result).toBeDefined();
    expect(result.bounds).toBeDefined();
  });
});
