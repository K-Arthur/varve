import { useDraggable } from '@dnd-kit/core';
import type { EffectStackKind } from '@varve/scene';
import { Tooltip } from '@varve/ui';
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import type { DragEffectStackData } from '../../dnd-types';

export interface EffectStackTransferBadgeProps {
  sourceId: string;
  sourceName: string;
  kind: EffectStackKind;
  count: number;
  /** Compact visual label, for example "2fx" or "2 filters". */
  children: ReactNode;
  /** Additional current-state detail, such as how many filters are enabled. */
  statusLabel?: string;
  /** Keyboard/touch alternative: copy to the currently selected target layers. */
  onCopyToSelected: () => void;
}

function stackLabel(kind: EffectStackKind, count: number): string {
  const noun = kind === 'layer-effects' ? 'Layer Effect' : 'Object Filter';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * A compact, accessible transfer source for a layer's matching appearance
 * stack. It is a real button as well as a pointer drag source, so users who
 * cannot or prefer not to drag can select target layers then activate it.
 */
export function EffectStackTransferBadge({
  sourceId,
  sourceName,
  kind,
  count,
  children,
  statusLabel,
  onCopyToSelected,
}: EffectStackTransferBadgeProps) {
  const didDragRef = useRef(false);
  const pointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `effect-stack:${kind}:${sourceId}`,
    data: {
      type: 'effect-stack',
      sourceId,
      stackKind: kind,
      transferMode: 'replace',
    } satisfies DragEffectStackData,
  });
  const { onPointerDown: onDndPointerDown, ...dndListeners } = listeners ?? {};
  const label = stackLabel(kind, count);

  useEffect(() => {
    if (isDragging) didDragRef.current = true;
  }, [isDragging]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      didDragRef.current = false;
      pointerOriginRef.current = { x: event.clientX, y: event.clientY };
      onDndPointerDown?.(event);
      // The containing layer row is itself sortable. The badge's separate
      // draggable identity must win so a transfer never starts a reparent.
      event.stopPropagation();
    },
    [onDndPointerDown],
  );

  const handlePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const origin = pointerOriginRef.current;
    if (!origin) return;
    // Match the DnD shell's five-pixel activation threshold. This suppresses
    // a browser click after a completed drag even if React has already reset
    // `isDragging` by the time pointerup dispatches it.
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >= 5) {
      didDragRef.current = true;
    }
  }, []);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (didDragRef.current) {
        event.preventDefault();
        didDragRef.current = false;
        return;
      }
      onCopyToSelected();
    },
    [onCopyToSelected],
  );

  const tooltip = `Drag to replace ${kind === 'layer-effects' ? 'Layer Effects' : 'Object Filters'} on another layer. Hold Alt/Option to append instead. Select target layers, then activate to copy without dragging.`;

  return (
    // The row needs to stop the pointer event from also activating its
    // sortable parent. That intentionally bypasses Tooltip's own
    // pointer-down handler, so explicitly close the hoverable portal while a
    // drag is active. Otherwise it can remain under the pointer and shadow a
    // destination row during a long drag.
    <Tooltip label={tooltip} open={isDragging ? false : undefined}>
      <button
        ref={setNodeRef}
        type="button"
        className={`layers-row__effect-stack-badge layers-row__${
          kind === 'layer-effects' ? 'effects' : 'object-filter'
        }-badge${isDragging ? ' layers-row__effect-stack-badge--dragging' : ''}`}
        aria-label={`${statusLabel ?? label} on ${sourceName}. ${tooltip}`}
        data-effect-stack-kind={kind}
        {...attributes}
        {...dndListeners}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onClick={handleClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}
