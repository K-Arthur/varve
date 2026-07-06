/**
 * Interactive animation export — Document.interactions to React/CSS scroll bindings.
 */
import type { Document } from '@strata/scene';

export interface InteractiveExportOptions {
  /** Emit CSS animation-timeline scroll bindings where supported. */
  useScrollTimeline?: boolean;
}

export interface InteractiveExportResult {
  reactHandlers: string;
  cssBindings: string;
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

function triggerToReactProp(kind: string): string {
  switch (kind) {
    case 'onClick':
      return 'onClick';
    case 'onHover':
      return 'onMouseEnter';
    case 'onKeyPress':
      return 'onKeyDown';
    case 'onLoad':
      return 'onLoad';
    default:
      return 'onClick';
  }
}

function isScrollTrigger(kind: string): boolean {
  return kind === 'onScroll' || kind === 'whileScrolling';
}

/** Export document interactions as React event handler stubs. */
export function exportInteractiveAnimations(
  doc: Document,
  options: InteractiveExportOptions = {},
): InteractiveExportResult {
  const interactions = doc.interactions ?? {};
  const handlerLines: string[] = [
    "import { useNavigate } from 'react-router-dom';",
    '',
    'export function useStrataInteractions() {',
    '  const navigate = useNavigate();',
    '  return {',
  ];
  const cssLines: string[] = [];

  for (const [nodeId, list] of Object.entries(interactions)) {
    for (const ix of list) {
      if (!ix.enabled) continue;
      const trigger = ix.trigger as { kind?: string };
      const triggerKind = String(trigger.kind ?? 'onClick');
      const fnName = `on_${sanitizeId(ix.id)}`;
      const primary = ix.actions[0] as {
        kind?: string;
        targetId?: string;
        transition?: { kind?: string; duration?: number };
      };

      handlerLines.push(`    /** ${ix.name} — node ${nodeId} */`);
      handlerLines.push(
        `    ${fnName}: (${triggerToReactProp(triggerKind)}: React.SyntheticEvent) => {`,
      );

      if (primary?.kind === 'navigateTo' && primary.targetId) {
        handlerLines.push(`      navigate('/screen/${primary.targetId}');`);
        if (primary.transition?.kind && primary.transition.kind !== 'instant') {
          handlerLines.push(
            `      // transition: ${primary.transition.kind} ${primary.transition.duration ?? 300}ms`,
          );
        }
      } else if (primary?.kind === 'openOverlay' && primary.targetId) {
        handlerLines.push(`      // openOverlay(${primary.targetId})`);
      } else if (primary?.kind === 'setVariable') {
        handlerLines.push(`      // setVariable action`);
      } else {
        handlerLines.push(`      // action: ${String(primary?.kind ?? 'unknown')}`);
      }

      handlerLines.push('    },');

      if (options.useScrollTimeline && isScrollTrigger(triggerKind)) {
        cssLines.push(`[data-strata-node="${nodeId}"] {`);
        cssLines.push('  animation-timeline: view();');
        cssLines.push('  animation-range: entry 0% cover 100%;');
        cssLines.push('}');
      }
    }
  }

  handlerLines.push('  };');
  handlerLines.push('}');

  if (options.useScrollTimeline && cssLines.length === 0) {
    cssLines.push('/* scroll-driven animation bindings */');
    cssLines.push('@supports (animation-timeline: scroll()) {');
    cssLines.push('  .strata-scroll-scene { view-timeline-name: --strata-scroll; }');
    cssLines.push('}');
  }

  return {
    reactHandlers: handlerLines.join('\n'),
    cssBindings: cssLines.join('\n'),
  };
}
