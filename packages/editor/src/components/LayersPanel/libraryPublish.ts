/**
 * Editor-side glue for publishing the selected component to a library.
 *
 * The scene package owns the library/package data model; this module only
 * resolves the selected component master and builds a transportable package.
 */

import type { ComponentDefinition, Document, LibraryPackage, NodeId } from '@varve/scene';
import { createLibrary, createLibraryPackage, publishComponentToLibrary } from '@varve/scene';

export function findComponentByMasterRootId(
  doc: Document,
  nodeId: NodeId,
): ComponentDefinition | undefined {
  return Object.values(doc.components).find((component) => component.masterRootId === nodeId);
}

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
