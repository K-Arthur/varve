/**
 * Branch and checkpoint naming policy tests (M9 core, ADR-0023).
 */

import { describe, expect, it } from 'vitest';
import {
  suggestBranchName,
  suggestUniqueBranchName,
  validateBranchName,
  validateCheckpointName,
} from '../branchNames';

describe('validateBranchName', () => {
  it('accepts plain names', () => {
    expect(validateBranchName('main')).toEqual({ valid: true });
    expect(validateBranchName('feature/landing-page')).toEqual({ valid: true });
    expect(validateBranchName('a.b_c-d/1.2')).toEqual({ valid: true });
  });

  it('rejects empty and over-long names', () => {
    expect(validateBranchName('').valid).toBe(false);
    expect(validateBranchName('a'.repeat(65)).valid).toBe(false);
  });

  it('rejects control characters', () => {
    expect(validateBranchName('a\u0000b').valid).toBe(false);
    expect(validateBranchName('a\tb').valid).toBe(false);
  });

  it('rejects leading/trailing slashes and dots', () => {
    expect(validateBranchName('/main').valid).toBe(false);
    expect(validateBranchName('main/').valid).toBe(false);
    expect(validateBranchName('.main').valid).toBe(false);
    expect(validateBranchName('main.').valid).toBe(false);
  });

  it('rejects reserved names', () => {
    expect(validateBranchName('HEAD').valid).toBe(false);
    expect(validateBranchName('..').valid).toBe(false);
  });

  it('rejects disallowed characters', () => {
    expect(validateBranchName('main branch').valid).toBe(false);
    expect(validateBranchName('main:branch').valid).toBe(false);
    expect(validateBranchName('main~branch').valid).toBe(false);
  });
});

describe('validateCheckpointName', () => {
  it('accepts human labels with spaces', () => {
    expect(validateCheckpointName('v1.0 release')).toEqual({ valid: true });
    expect(validateCheckpointName('final')).toEqual({ valid: true });
  });

  it('rejects control characters and whitespace padding', () => {
    expect(validateCheckpointName('a\u0001b').valid).toBe(false);
    expect(validateCheckpointName(' padded ').valid).toBe(false);
  });
});

describe('suggestBranchName', () => {
  it('sanitizes free-form text', () => {
    expect(suggestBranchName('My Feature Branch!')).toBe('My-Feature-Branch');
    expect(suggestBranchName('  --clean--  ')).toBe('clean');
    expect(suggestBranchName('a'.repeat(100))).toHaveLength(64);
    expect(suggestBranchName('HEAD')).toBe('HEAD-1');
    expect(suggestBranchName('///')).toBe('branch');
  });

  it('avoids collisions with a numeric suffix', () => {
    expect(suggestUniqueBranchName('main', ['main', 'main-2', 'main-3'])).toBe('main-4');
    expect(suggestUniqueBranchName('main', ['main'])).toBe('main-2');
    expect(suggestUniqueBranchName('main', [])).toBe('main');
  });
});
