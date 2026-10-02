import { describe, expect, it } from 'vitest';
import {
  buildCommentBody,
  isUpdateableComment,
  sanitizeInlineCode,
} from '../../scripts/pr-debug-comment.mjs';

/**
 * Regression coverage for the trusted-workflow PR commenter.
 *
 * The commenter runs from the default branch with `issues: write` after an
 * untrusted pull request fails. Two properties matter and are easy to lose:
 *   1. Untrusted metadata must never escape the Markdown structure it is
 *      placed into (a fork head branch is attacker-controlled).
 *   2. The bot must only ever rewrite its own comment, never a contributor's.
 */
describe('sanitizeInlineCode', () => {
  it('removes the backticks that would close the surrounding code span', () => {
    expect(sanitizeInlineCode('feature/`injected`')).toBe('feature/injected');
  });

  it('collapses newlines and control characters into a single line', () => {
    expect(sanitizeInlineCode('main\n\n## Forged heading')).toBe('main ## Forged heading');
    expect(sanitizeInlineCode('main\u0000\u001b[31m')).toBe('main[31m');
  });

  it('bounds the value so a huge branch name cannot flood the comment', () => {
    expect(sanitizeInlineCode('a'.repeat(500))).toHaveLength(120);
  });

  it('falls back for empty, whitespace-only and non-string input', () => {
    expect(sanitizeInlineCode('   ')).toBe('unknown');
    expect(sanitizeInlineCode('')).toBe('unknown');
    expect(sanitizeInlineCode(undefined)).toBe('unknown');
    expect(sanitizeInlineCode(42)).toBe('unknown');
    expect(sanitizeInlineCode('', 'Unknown')).toBe('Unknown');
  });
});

describe('isUpdateableComment', () => {
  const body = '## CI Failure Debug Report\n\ncontent';

  it('adopts the authenticated actor comment that carries the marker', () => {
    expect(
      isUpdateableComment({ body, user: { login: 'github-actions[bot]' } }, 'github-actions[bot]'),
    ).toBe(true);
  });

  it('refuses a contributor comment that copies the marker', () => {
    expect(
      isUpdateableComment({ body, user: { login: 'outside-contributor' } }, 'github-actions[bot]'),
    ).toBe(false);
  });

  it('never adopts anything when the actor identity is unknown', () => {
    expect(isUpdateableComment({ body, user: { login: 'github-actions[bot]' } }, null)).toBe(false);
  });

  it('ignores the actor comment that is not a debug report', () => {
    expect(isUpdateableComment({ body: 'unrelated', user: { login: 'bot' } }, 'bot')).toBe(false);
  });
});

describe('buildCommentBody', () => {
  const base = {
    repo: 'K-Arthur/varve',
    runId: 12345,
    runName: 'CI',
    runBranch: 'feature/x',
    runSha: 'abcdef1234567890abcdef1234567890abcdef12',
    reportContent: 'report body',
  };

  it('contains the report and links the run', () => {
    const body = buildCommentBody(base);
    expect(body).toContain('CI Failure Debug Report');
    expect(body).toContain('report body');
    expect(body).toContain('https://github.com/K-Arthur/varve/actions/runs/12345');
    expect(body).toContain('`abcdef1`');
  });

  it('keeps an injected branch name inside its code span', () => {
    const body = buildCommentBody({ ...base, runBranch: 'x`\n\n## Forged\n\n`' });
    // The payload must never become a rendered heading: no line may start with
    // it, and the branch must stay on the single line that names it.
    const lines = body.split('\n');
    expect(lines.some((line) => line.trim() === '## Forged')).toBe(false);
    const branchLine = lines.find((line) => line.startsWith('**Branch:**'));
    expect(branchLine).toBe('**Branch:** `x ## Forged`');
  });

  it('does not emit emoji (repository hard rule: zero emoji anywhere)', () => {
    const body = buildCommentBody({ ...base, runBranch: 'main' });
    expect(body).not.toMatch(/[\u{2600}-\u{27BF}\u{1F000}-\u{1FAFF}\p{Extended_Pictographic}]/u);
  });
});
