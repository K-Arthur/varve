import { useEffect, useRef, useState } from 'react';
import type { HelpArticle } from '../ContextualHelp/helpContent';
import { getHelpContent } from '../ContextualHelp/helpContent';
import './WhatIsThis.css';

interface WhatIsThisProps {
  open: boolean;
  onOpenHelp: (article: HelpArticle) => void;
  onExit: () => void;
}

/** Map of tool aria-labels to help content article IDs. */
const TOOL_HELP_MAP: Record<string, string> = {
  select: 'tool:select',
  rectangle: 'tool:rect',
  ellipse: 'tool:ellipse',
  polygon: 'tool:polygon',
  star: 'tool:star',
  line: 'tool:line',
  arrow: 'tool:arrow',
  pen: 'tool:pen',
  pencil: 'tool:pencil',
  text: 'tool:text',
  frame: 'tool:frame',
  hand: 'tool:hand',
  zoom: 'tool:zoom',
  slice: 'tool:slice',
  'export region': 'tool:slice',
  knife: 'tool:knife',
  eyedropper: 'tool:eyedropper',
  scale: 'tool:scale',
  inspect: 'tool:inspect',
  'clone stamp': 'tool:cloneStamp',
  'healing brush': 'tool:healBrush',
  'spot heal': 'tool:spotHeal',
  'patch tool': 'tool:patch',
  union: 'tool:booleanUnion',
  subtract: 'tool:booleanSubtract',
  intersect: 'tool:booleanIntersect',
  exclude: 'tool:booleanExclude',
};

export function WhatIsThis({ open, onOpenHelp, onExit }: WhatIsThisProps) {
  const [hint, setHint] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setHint(null);
      return;
    }

    document.body.style.cursor = 'help';
    setHint('Click any tool, panel, or element to learn about it');
    // Announce mode entry to screen readers
    const announcer = document.createElement('div');
    announcer.setAttribute('role', 'status');
    announcer.setAttribute('aria-live', 'polite');
    announcer.className = 'sr-only';
    announcer.textContent =
      'What is this mode activated. Click any tool, panel, or element to learn about it. Press Escape to exit.';
    document.body.appendChild(announcer);
    setTimeout(() => announcer.remove(), 3000);

    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      // Try to find the help article id from the clicked element
      const articleId = resolveElementToHelp(target);
      if (articleId) {
        e.preventDefault();
        e.stopPropagation();
        const article = getHelpContent(articleId);
        if (article) {
          onOpenHelp(article);
        }
        onExit();
      }
    };

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.shiftKey && e.key === 'F1')) {
        e.preventDefault();
        onExit();
      }
    };

    window.addEventListener('click', handler, true);
    window.addEventListener('keydown', keyHandler);

    return () => {
      document.body.style.cursor = '';
      setHint(null);
      window.removeEventListener('click', handler, true);
      window.removeEventListener('keydown', keyHandler);
    };
  }, [open, onOpenHelp, onExit]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="what-is-this"
      role="status"
      aria-live="polite"
      aria-label="What is this mode"
    >
      <div className="what-is-this__hint">
        <span className="what-is-this__hint-icon">?</span>
        {hint}
      </div>
    </div>
  );
}

/**
 * Given a clicked DOM element, determine which help article ID it
 * corresponds to by traversing ancestors and checking for known patterns.
 */
function resolveElementToHelp(el: HTMLElement): string | null {
  let current: HTMLElement | null = el;
  while (current) {
    // Check for data-panel attribute
    const panel = current.getAttribute?.('data-panel');
    if (panel && getHelpContent(`panel:${panel}`)) return `panel:${panel}`;

    // Check for data-tool attribute
    const tool = current.getAttribute?.('data-tool');
    if (tool && getHelpContent(`tool:${tool}`)) return `tool:${tool}`;

    // Check aria-label for known tool names
    const ariaLabel = current.getAttribute?.('aria-label')?.toLowerCase() ?? '';
    for (const [name, helpId] of Object.entries(TOOL_HELP_MAP)) {
      if (ariaLabel.includes(name) && getHelpContent(helpId)) return helpId;
    }

    // Check title attribute
    const titleLabel = (current.getAttribute?.('title') ?? '').toLowerCase();
    if (titleLabel) {
      for (const [name, helpId] of Object.entries(TOOL_HELP_MAP)) {
        if (titleLabel.includes(name) && getHelpContent(helpId)) return helpId;
      }
    }

    current = current.parentElement;
  }
  return null;
}
