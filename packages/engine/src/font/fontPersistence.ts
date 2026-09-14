/**
 * Font persistence — bridges font manifest with document save/load.
 *
 * Provides thin integration helpers that stamp a font manifest onto a document
 * before serialization and re-resolve the manifest after deserialization so
 * cross-device font discovery happens automatically.
 *
 * These functions are called from the editor persistence layer
 * (usePersistence.ts / context.tsx) and are intentionally stateless: they
 * accept a FontCatalog and document, and return the updated document.
 */

import type { FontCatalog } from './fontCatalog';
import type { FontManifest } from './fontManifest';
import {
  buildDocumentFontManifest,
  migrateFontManifest,
  resolveManifestAgainstCatalog,
} from './fontManifest';
import type { UsageDocument } from './fontUsageIndex';

export interface FontPersistenceResult {
  manifest: FontManifest;
  document: UsageDocument;
}

/**
 * Build a font manifest for a document about to be saved.
 *
 * Scans all text nodes and styles, resolves them against the current font
 * catalog, and stamps the manifest onto the document for cross-device
 * portability. Also flags any restricted-embedding fonts so the export
 * pipeline can enforce license terms.
 */
export function attachFontManifestToDocument(
  doc: UsageDocument,
  catalog: FontCatalog,
): FontPersistenceResult {
  const previousReplacements = (doc as UsageDocument & { fontManifest?: FontManifest }).fontManifest
    ?.replacements;
  const manifest = buildDocumentFontManifest(doc, catalog, {
    autoSubstitute: false,
    missingSource: 'missing',
    previousReplacements,
  });

  return {
    manifest,
    document: { ...doc, fontManifest: manifest } as UsageDocument,
  };
}

/**
 * Resolve a font manifest against the current device's font catalog after
 * loading a document.  Re-checks availability, substitutes, and embedding
 * rights, returning a fresh manifest plus any resolution warnings.
 */
export function resolveFontManifestForLoadedDocument(
  manifest: FontManifest,
  catalog: FontCatalog,
): {
  resolved: FontManifest;
  warnings: string[];
} {
  const resolved = resolveManifestAgainstCatalog(migrateFontManifest(manifest), catalog);
  const warnings: string[] = [];

  for (const entry of resolved.fonts) {
    if (entry.status === 'missing') {
      warnings.push(
        `Font "${entry.familyName}" is not available on this device. ` +
          `Text using this font may appear differently than intended.`,
      );
    } else if (entry.status === 'substituted') {
      warnings.push(
        `Font "${entry.substituteFor ?? entry.familyName}" was substituted ` +
          `with "${entry.familyName}". Layout may differ.`,
      );
    } else if (entry.status === 'restricted') {
      warnings.push(
        `Font "${entry.familyName}" has restricted embedding permissions. ` +
          `It cannot be included in exported documents or packages.`,
      );
    } else if (entry.status === 'corrupt') {
      warnings.push(
        `Font "${entry.familyName}" has corrupt stored bytes. Repair or re-import the exact face before export.`,
      );
    } else if (entry.status === 'unsupported') {
      warnings.push(
        `Font "${entry.familyName}" is unsupported by this renderer. Choose a compatible face or outline the text.`,
      );
    } else if (entry.status === 'permission-denied') {
      warnings.push(
        `Font "${entry.familyName}" needs local-font permission before it can be restored.`,
      );
    } else if (entry.status === 'offline') {
      warnings.push(
        `Font "${entry.familyName}" is not stored locally and cannot be recovered while offline.`,
      );
    } else if (entry.status === 'loading') {
      warnings.push(`Font "${entry.familyName}" is still loading; wait before exporting.`);
    } else if (entry.status === 'error') {
      warnings.push(`Font "${entry.familyName}" has no ready rendering path on this device.`);
    }
  }

  return { resolved, warnings };
}
