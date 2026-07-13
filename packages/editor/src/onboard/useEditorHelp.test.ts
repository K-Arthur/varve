// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolId } from '../context/types';
import { getHelpContent } from './ContextualHelp/helpContent';
import { resolveToolHelpArticleId, useEditorHelp } from './useEditorHelp';

describe('resolveToolHelpArticleId', () => {
  it('maps standard tools to tool:* articles', () => {
    expect(resolveToolHelpArticleId('rect')).toBe('tool:rect');
    expect(getHelpContent('tool:rect')).toBeTruthy();
  });

  it('maps boolean tools to boolean help articles', () => {
    expect(resolveToolHelpArticleId('booleanUnion' as ToolId)).toBe('tool:booleanUnion');
  });

  it('returns null for tools without help articles', () => {
    expect(resolveToolHelpArticleId('refineMask' as ToolId)).toBeNull();
  });
});

describe('useEditorHelp', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens contextual help for the active tool on openContextualHelp', () => {
    const { result } = renderHook(() => useEditorHelp('rect'));

    act(() => {
      result.current.openContextualHelp();
    });

    expect(result.current.contextual.state.open).toBe(true);
    expect(result.current.contextual.state.article?.id).toBe('tool:rect');
  });

  it('toggles What Is This mode', () => {
    const { result } = renderHook(() => useEditorHelp('select'));

    act(() => {
      result.current.toggleWhatIsThis();
    });
    expect(result.current.whatIsThisOpen).toBe(true);

    act(() => {
      result.current.toggleWhatIsThis();
    });
    expect(result.current.whatIsThisOpen).toBe(false);
  });

  it('Shift+F1 alone does not fire when Ctrl is held (help center takes precedence)', () => {
    const { result } = renderHook(() => useEditorHelp('select'));

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F1', shiftKey: true, ctrlKey: true }),
      );
    });

    expect(result.current.whatIsThisOpen).toBe(false);
  });
  it('Shift+F1 toggles What Is This mode', () => {
    const { result } = renderHook(() => useEditorHelp('select'));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', shiftKey: true }));
    });

    expect(result.current.whatIsThisOpen).toBe(true);
  });

  it('opens help center independently of contextual panel', () => {
    const { result } = renderHook(() => useEditorHelp('select'));

    act(() => {
      result.current.setHelpCenterOpen(true);
    });

    expect(result.current.helpCenterOpen).toBe(true);
    expect(result.current.contextual.state.open).toBe(false);
  });

  it('routes What Is This article selection into contextual help', () => {
    const { result } = renderHook(() => useEditorHelp('select'));
    const article = getHelpContent('tool:rect');
    expect(article).toBeTruthy();
    if (!article) return;

    act(() => {
      result.current.toggleWhatIsThis();
      result.current.handleWhatIsThisArticle(article);
    });

    expect(result.current.whatIsThisOpen).toBe(false);
    expect(result.current.contextual.state.open).toBe(true);
    expect(result.current.contextual.state.article?.id).toBe('tool:rect');
  });
});
