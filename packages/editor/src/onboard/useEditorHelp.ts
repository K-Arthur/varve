import { useCallback, useEffect, useState } from 'react';
import type { ToolId } from '../context/types';
import type { HelpArticle } from './ContextualHelp/helpContent';
import { getHelpContent, getHelpContext } from './ContextualHelp/helpContent';
import { useContextualHelp } from './ContextualHelp/useContextualHelp';

const BOOLEAN_TOOL_MAP: Record<string, string> = {
  booleanUnion: 'tool:booleanUnion',
  booleanSubtract: 'tool:booleanSubtract',
  booleanIntersect: 'tool:booleanIntersect',
  booleanExclude: 'tool:booleanExclude',
};

/** Resolve the bundled help article id for the active editor tool. */
export function resolveToolHelpArticleId(tool: ToolId): string | null {
  const booleanId = BOOLEAN_TOOL_MAP[tool];
  if (booleanId && getHelpContent(booleanId)) return booleanId;
  const id = `tool:${tool}`;
  return getHelpContent(id) ? id : null;
}

export function useEditorHelp(currentTool: ToolId) {
  const contextual = useContextualHelp();
  const [whatIsThisOpen, setWhatIsThisOpen] = useState(false);
  const [helpCenterOpen, setHelpCenterOpen] = useState(false);

  const openContextualHelp = useCallback(() => {
    const articleId = resolveToolHelpArticleId(currentTool) ?? getHelpContext();
    contextual.open(articleId ?? undefined);
  }, [currentTool, contextual]);

  const toggleWhatIsThis = useCallback(() => {
    setWhatIsThisOpen((open) => !open);
  }, []);

  const exitWhatIsThis = useCallback(() => {
    setWhatIsThisOpen(false);
  }, []);

  const handleWhatIsThisArticle = useCallback(
    (article: HelpArticle) => {
      contextual.open(article.id);
      setWhatIsThisOpen(false);
    },
    [contextual],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'F1' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      const tag = target.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable)
        return;
      e.preventDefault();
      toggleWhatIsThis();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleWhatIsThis]);

  return {
    contextual,
    whatIsThisOpen,
    helpCenterOpen,
    setHelpCenterOpen,
    openContextualHelp,
    toggleWhatIsThis,
    exitWhatIsThis,
    handleWhatIsThisArticle,
  };
}
