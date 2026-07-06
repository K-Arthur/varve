/**
 * Editor-side glue for publishing the selected component to a library.
 *
 * `@strata/scene`'s library.ts owns the actual publish/package data model;
 * this module just resolves "which component does the current selection
 * belong to" and builds a transportable package from it — kept as a pure
 * function so it's testable without mounting the editor context.
 */

import type { ComponentDefinition, Document, LibraryPackage, NodeId } from '@strata/scene';
import { createLibrary, createLibraryPackage, publishComponentToLibrary } from '@strata/scene';

/**
 * Find the component definition whose master root is `nodeId` — i.e. `nodeId`
 * is the component's canonical definition, not one of its instances.
 */
export function findComponentByMasterRootId(
  doc: Document,
  nodeId: NodeId,
): ComponentDefinition | undefined {
  return Object.values(doc.components).find((c) => c.masterRootId === nodeId);
}

/**
 * Build a transportable library package for the component defined by
 * `nodeId`'s master root. Returns null when `nodeId` isn't a component
 * master (e.g. it's an instance, or an unrelated node) — callers use this to
 * no-op rather than publish something meaningless.
 */
export function buildComponentLibraryPackage(
  doc: Document,
  nodeId: NodeId,
): { pkg: LibraryPackage; component: ComponentDefinition } | null {
  const component = findComponentByMasterRootId(doc, nodeId);
  if (!component) return null;

  const library = createLibrary(doc.name || 'Library');
  const { library: published } = publishComponentToLibrary(library, component, doc);
  const pkg = createLibraryPackage(published, doc.id);
  return { pkg, component };
}
