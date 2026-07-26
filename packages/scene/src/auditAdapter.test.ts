/**
 * Smoke tests for the built-in audit rule registration.
 *
 * registerBuiltinRules() was defined but never called from application code
 * until it was wired into packages/editor/src/Shell.tsx's mount effect —
 * meaning createBuiltinRules()'s rule definitions had never actually been
 * exercised end-to-end. These tests are the first real verification that
 * registering the built-in rules and running a scan doesn't throw.
 */
import { describe, expect, it, vi } from 'vitest';
import { registerBuiltinRules } from './auditAdapter';
import { clearRules, getAllRules, runAudit } from './auditEngine';
import { createDocument } from './document';

describe('registerBuiltinRules', () => {
  it('registers a non-empty set of rules', () => {
    clearRules();
    registerBuiltinRules();
    expect(getAllRules().length).toBeGreaterThan(0);
  });

  it('is idempotent -- registering twice does not duplicate or throw', () => {
    clearRules();
    registerBuiltinRules();
    const firstCount = getAllRules().length;
    expect(() => registerBuiltinRules()).not.toThrow();
    expect(getAllRules().length).toBe(firstCount);
  });

  it('runAudit does not throw against an empty document, across every stage', () => {
    clearRules();
    registerBuiltinRules();
    const doc = createDocument('Smoke test doc');

    for (const stage of ['immediate', 'debounced', 'on-demand', 'preflight'] as const) {
      expect(() =>
        runAudit(
          {
            doc,
            workspaceMode: 'design',
            canvasMode: 'full',
            tool: 'select',
            selection: [],
            isPresenting: false,
          },
          { stages: [stage] },
        ),
      ).not.toThrow();
    }
  });

  it('runAudit against an empty document crashes no rule', () => {
    clearRules();
    registerBuiltinRules();
    const doc = createDocument('Smoke test doc');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const report = runAudit({
        doc,
        workspaceMode: 'design',
        canvasMode: 'full',
        tool: 'select',
        selection: [],
        isPresenting: false,
      });

      // runRule() catches per-rule exceptions and logs via console.error rather
      // than propagating -- a crash wouldn't fail this test any other way.
      expect(errorSpy).not.toHaveBeenCalled();
      expect(report.ruleResults.length).toBeGreaterThan(0);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
