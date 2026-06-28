/**
 * Component definitions with typed slots (Strata plan §3.1, priority 8.33).
 *
 * This is the #1 differentiator. The shape here is SLOTS-READY: a component
 * declares typed slots; an instance fills slots with arbitrary local content;
 * master edits to non-slot regions propagate while slot content stays local.
 *
 * Task 1.1 implements instance creation, slot-fill enforcement, and master
 * propagation. The data shapes below are stable and will not change.
 */
import type { NodeId } from './types';

export type SlotKind = 'single' | 'multiple' | 'text';

export interface Slot {
  id: string;
  name: string;
  kind: SlotKind;
  /** Optional default content (NodeId of a node used as the default fill). */
  defaultContentId?: NodeId;
}

export interface ComponentDefinition {
  id: NodeId;
  name: string;
  /** Typed slots this component accepts. */
  slots: Slot[];
  /** Root of the master tree (the synchronized template). */
  masterRootId: NodeId;
}

/** Whether `frameSlots` fills every slot declared by `component`. */
export function slotsSatisfied(
  component: ComponentDefinition,
  frameSlots: Record<string, NodeId>,
): boolean {
  return component.slots.every((s) => Object.hasOwn(frameSlots, s.id));
}
