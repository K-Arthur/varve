import type { Platform } from '@strata/platform';
import type { Document } from '@strata/scene';

export interface CrossDocIssue {
  fileId: string;
  fileName: string;
  issueType: 'color-drift' | 'component-misuse' | 'style-duplication';
  message: string;
}

export async function scanCrossDocument(
  doc: Document,
  platform?: Platform,
): Promise<CrossDocIssue[]> {
  if (!platform || typeof platform.searchFileContent !== 'function') {
    return [];
  }

  const issues: CrossDocIssue[] = [];

  const allFileEntries = await platform.listFiles().catch(() => []);
  const relatedFiles = allFileEntries.filter((f) => f.id !== doc.id);

  if (relatedFiles.length === 0) return [];

  for (const file of relatedFiles) {
    const fileName = file.name;
    const fileId = file.id;

    const colorRefs = extractColorRefs(doc);
    for (const color of colorRefs) {
      const hits = await platform.searchFileContent(fileId, color).catch(() => []);
      if (hits.length > 0) {
        issues.push({
          fileId,
          fileName,
          issueType: 'color-drift',
          message: `Color "${color}" in "${doc.name}" appears in "${fileName}" — verify color consistency`,
        });
      }
    }

    const componentNames = extractComponentNames(doc);
    for (const compName of componentNames) {
      const hits = await platform.searchFileContent(fileId, compName).catch(() => []);
      if (hits.length > 0) {
        issues.push({
          fileId,
          fileName,
          issueType: 'component-misuse',
          message: `Component "${compName}" from "${doc.name}" referenced in "${fileName}" — ensure correct usage`,
        });
      }
    }

    const styleNames = extractStyleNames(doc);
    for (const styleName of styleNames) {
      const hits = await platform.searchFileContent(fileId, styleName).catch(() => []);
      if (hits.length > 0) {
        issues.push({
          fileId,
          fileName,
          issueType: 'style-duplication',
          message: `Style "${styleName}" from "${doc.name}" duplicated in "${fileName}" — consider consolidating`,
        });
      }
    }
  }

  return issues;
}

function extractColorRefs(doc: Document): string[] {
  const refs = new Set<string>();
  if (doc.swatches) {
    for (const swatch of doc.swatches) {
      const c = swatch.color;
      if (c.space === 'rgb') {
        refs.add(`rgb(${c.r},${c.g},${c.b})`);
      } else if (c.space === 'cmyk') {
        refs.add(`cmyk(${c.c},${c.m},${c.y},${c.k})`);
      }
    }
  }
  return Array.from(refs);
}

function extractComponentNames(doc: Document): string[] {
  return Object.values(doc.components)
    .filter((c) => c.name)
    .map((c) => c.name);
}

function extractStyleNames(doc: Document): string[] {
  if (!doc.styles) return [];
  return Object.values(doc.styles)
    .filter((s) => s.name)
    .map((s) => s.name);
}
