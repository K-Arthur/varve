import {
  type CollisionDetection,
  closestCenter,
  closestCorners,
  DndContext,
  type DndContextProps,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragMoveEvent,
  type DragOverEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext as DndSortableContext,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { createContext, createElement, useContext, useMemo, useState } from 'react';

export type SortableLayout = 'vertical' | 'horizontal' | 'grid';

export interface SortableItemRenderProps {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  setNodeRef: (element: HTMLElement | null) => void;
  transform: string | undefined;
  transition: string | undefined;
  isDragging: boolean;
}

export interface SortableEndResult {
  event: DragEndEvent;
  /** Null means no destination, a stale ID, or a same-position drop. */
  items: UniqueIdentifier[] | null;
}

export interface SortableProps {
  items: readonly UniqueIdentifier[];
  children: ReactNode;
  layout?: SortableLayout;
  /** Six CSS pixels distinguishes an intentional drag from a click. */
  activationDistance?: number;
  /** Called for valid moves, after IDs have been checked and reordered. */
  onReorder?: (result: SortableEndResult) => void;
  onDragStart?: DndContextProps['onDragStart'];
  onDragMove?: (event: DragMoveEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  onDragCancel?: DndContextProps['onDragCancel'];
  /** Render a non-interactive preview in the shared portal overlay. */
  renderOverlay?: (id: UniqueIdentifier) => ReactNode;
  className?: string;
}

/** The shared sensor policy for ordinary collections. */
export function useSortableSensors(activationDistance = 6) {
  return useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: activationDistance },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
}

function layoutConfig(layout: SortableLayout): {
  strategy: typeof verticalListSortingStrategy;
  collisionDetection: CollisionDetection;
} {
  if (layout === 'horizontal') {
    return {
      strategy: horizontalListSortingStrategy,
      collisionDetection: closestCenter,
    };
  }
  if (layout === 'grid') {
    return {
      strategy: rectSortingStrategy,
      collisionDetection: closestCorners,
    };
  }
  return {
    strategy: verticalListSortingStrategy,
    collisionDetection: closestCenter,
  };
}

/**
 * Reorder stable IDs defensively. The returned array is null for a stale,
 * missing, or same-position destination. It deliberately does not accept
 * indexes so callers cannot accidentally persist rendered positions.
 */
export function reorderSortableItems(
  items: readonly UniqueIdentifier[],
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier | null | undefined,
): UniqueIdentifier[] | null {
  if (overId == null || activeId === overId) return null;
  const activeIndex = items.indexOf(activeId);
  const overIndex = items.indexOf(overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return null;
  return arrayMove([...items], activeIndex, overIndex);
}

function uniqueItems(items: readonly UniqueIdentifier[]): UniqueIdentifier[] {
  return [...new Set(items)];
}

export function Sortable({
  items,
  children,
  layout = 'vertical',
  activationDistance = 6,
  onReorder,
  onDragStart,
  onDragMove,
  onDragOver,
  onDragCancel,
  renderOverlay,
  className,
}: SortableProps) {
  const normalizedItems = useMemo(() => uniqueItems(items), [items]);
  const { strategy, collisionDetection } = layoutConfig(layout);
  const sensors = useSortableSensors(activationDistance);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

  const handleDragStart: DndContextProps['onDragStart'] = (event) => {
    setActiveId(event.active.id);
    onDragStart?.(event);
  };
  const handleDragEnd = (event: DragEndEvent) => {
    const nextItems = reorderSortableItems(normalizedItems, event.active.id, event.over?.id);
    setActiveId(null);
    onReorder?.({ event, items: nextItems });
  };
  const handleDragCancel: DndContextProps['onDragCancel'] = (event) => {
    setActiveId(null);
    onDragCancel?.(event);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <DndSortableContext items={normalizedItems} strategy={strategy}>
        {children}
      </DndSortableContext>
      {renderOverlay ? (
        <DragOverlay dropAnimation={null} className={className}>
          {activeId == null ? null : renderOverlay(activeId)}
        </DragOverlay>
      ) : null}
    </DndContext>
  );
}

const SortableItemContext = createContext<SortableItemRenderProps | null>(null);

export interface SortableItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'id'> {
  id: UniqueIdentifier;
  as?: 'div' | 'li';
  data?: Record<string, unknown>;
  disabled?: boolean;
  /** Use for simple cards/tabs without nested controls. */
  dragFromItem?: boolean;
  children: ReactNode | ((props: SortableItemRenderProps) => ReactNode);
}

export function SortableItem({
  id,
  as = 'div',
  data,
  disabled = false,
  dragFromItem = false,
  children,
  className,
  style,
  ...rest
}: SortableItemProps) {
  const sortable = useSortable({ id, data, disabled });
  const renderProps: SortableItemRenderProps = {
    attributes: sortable.attributes,
    listeners: sortable.listeners,
    setNodeRef: sortable.setNodeRef,
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    isDragging: sortable.isDragging,
  };
  const itemStyle: CSSProperties = {
    ...style,
    transform: renderProps.transform,
    transition: renderProps.transition,
    opacity: sortable.isDragging ? 0.45 : style?.opacity,
  };
  const Element = as;

  const elementProps = {
    ref: sortable.setNodeRef,
    className: `varve-sortable-item${sortable.isDragging ? ' varve-sortable-item--dragging' : ''}${className ? ` ${className}` : ''}`,
    style: itemStyle,
    'data-sortable-item': String(id),
    ...(dragFromItem ? sortable.attributes : {}),
    ...(dragFromItem ? sortable.listeners : {}),
    ...rest,
  } as React.HTMLAttributes<HTMLElement> & { ref: typeof sortable.setNodeRef };
  return (
    <SortableItemContext.Provider value={renderProps}>
      {createElement(
        Element,
        elementProps,
        typeof children === 'function' ? children(renderProps) : children,
      )}
    </SortableItemContext.Provider>
  );
}

/**
 * Hook form for existing cards that cannot be wrapped by SortableItem without
 * changing their DOM or virtualization boundary.
 */
export function useSortableItem({
  id,
  data,
  disabled = false,
}: {
  id: UniqueIdentifier;
  data?: Record<string, unknown>;
  disabled?: boolean;
}) {
  const sortable = useSortable({ id, data, disabled });
  return {
    ...sortable,
    renderProps: {
      attributes: sortable.attributes,
      listeners: sortable.listeners,
      setNodeRef: sortable.setNodeRef,
      transform: CSS.Transform.toString(sortable.transform),
      transition: sortable.transition,
      isDragging: sortable.isDragging,
    } satisfies SortableItemRenderProps,
  };
}

export interface SortableItemHandleProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children?: ReactNode;
  sortable?: SortableItemRenderProps;
}

/** A quiet, keyboard-accessible handle for rows containing controls. */
export function SortableItemHandle({
  children,
  className,
  type = 'button',
  sortable: sortableProp,
  ...rest
}: SortableItemHandleProps) {
  const contextSortable = useContext(SortableItemContext);
  const sortable = sortableProp ?? contextSortable;
  if (!sortable) {
    throw new Error('SortableItemHandle must be rendered inside SortableItem');
  }
  return (
    <button
      type={type}
      className={`varve-sortable-handle${className ? ` ${className}` : ''}`}
      aria-label={rest['aria-label'] ?? 'Drag to reorder'}
      {...sortable.attributes}
      {...sortable.listeners}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SortableOverlay({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`varve-sortable-overlay${className ? ` ${className}` : ''}`} style={style}>
      {children}
    </div>
  );
}
