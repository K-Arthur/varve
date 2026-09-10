import { describe, expect, it } from 'vitest';
import { isCommonPassword } from './commonPasswords';

describe('isCommonPassword', () => {
  it('flags common passwords from the OWASP list', () => {
    expect(isCommonPassword('password')).toBe(true);
    expect(isCommonPassword('123456')).toBe(true);
    expect(isCommonPassword('admin')).toBe(true);
    expect(isCommonPassword('letmein')).toBe(true);
    expect(isCommonPassword('welcome')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isCommonPassword('Password')).toBe(true);
    expect(isCommonPassword('PASSWORD')).toBe(true);
    expect(isCommonPassword('Admin')).toBe(true);
  });

  it('does not flag strong unique passwords', () => {
    expect(isCommonPassword('Tr0ub4dor&3')).toBe(false);
    expect(isCommonPassword('correcthorsebatterystaple')).toBe(false);
    expect(isCommonPassword('MyS3cur3P@ss!')).toBe(false);
  });

  it('flags common passwords with trailing whitespace removed', () => {
    expect(isCommonPassword(' password ')).toBe(true);
    expect(isCommonPassword('admin  ')).toBe(true);
  });

  it('handles empty string gracefully', () => {
    expect(isCommonPassword('')).toBe(false);
  });
});
