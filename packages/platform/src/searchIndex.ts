/**
 * @strata/platform — content search index for design documents.
 *
 * Builds a lightweight inverted index from Document JSON, mapping searchable
 * terms (node names, text content, component names) back to file and node IDs.
 * Used by platform implementations (memory, web, tauri) for content-aware search.
 */

export interface ContentSearchMatch {
  fileId: string;
  nodeId: string;
  nodeName: string;
  matchType: 'name' | 'text' | 'component';
  snippet: string;
}

export interface ContentSearchResult {
  fileId: string;
  fileName: string;
  matches: ContentSearchMatch[];
}

/**
 * Extract searchable terms from a Document JSON string.
 * Returns a map of normalized term → node IDs for fast lookup.
 */
export function indexDocumentContent(
  fileId: string,
  docJson: string,
): Map<string, ContentSearchMatch> {
  const index = new Map<string, ContentSearchMatch>();

  try {
    const doc = JSON.parse(docJson);
    const nodes: Record<string, Record<string, unknown>> = doc.nodes ?? {};
    const components: Record<string, Record<string, unknown>> = doc.components ?? {};

    for (const [nodeId, node] of Object.entries(nodes)) {
      const name = (node.name as string) ?? '';
      const text = (node.text as string) ?? '';

      // Index by node name
      const nameTerms = tokenize(name);
      for (const term of nameTerms) {
        if (!index.has(term)) {
          index.set(term, {
            fileId,
            nodeId,
            nodeName: name,
            matchType: 'name',
            snippet: name,
          });
        }
      }

      // Index by text content (for text nodes)
      if (text.trim()) {
        const textTerms = tokenize(text);
        for (const term of textTerms) {
          const existing = index.get(term);
          if (existing?.matchType !== 'text' || existing.nodeId !== nodeId) {
            index.set(term, {
              fileId,
              nodeId,
              nodeName: name,
              matchType: 'text',
              snippet: text.length > 80 ? `${text.slice(0, 77)}...` : text,
            });
          }
        }
      }
    }

    // Index component names
    for (const [compId, comp] of Object.entries(components)) {
      const compName = (comp.name as string) ?? '';
      const compTerms = tokenize(compName);
      for (const term of compTerms) {
        if (!index.has(term)) {
          index.set(term, {
            fileId,
            nodeId: compId,
            nodeName: compName,
            matchType: 'component',
            snippet: `Component: ${compName}`,
          });
        }
      }
    }
  } catch {
    // Invalid JSON — skip indexing
  }

  return index;
}

/**
 * Search a pre-built content index for matching terms.
 * Returns up to `limit` results per file.
 */
export function searchContentIndex(
  index: Map<string, ContentSearchMatch>,
  query: string,
  limit = 20,
): ContentSearchMatch[] {
  if (!query.trim()) return [];
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const seen = new Set<string>();
  const results: ContentSearchMatch[] = [];

  for (const term of terms) {
    for (const [key, match] of index) {
      if (key.includes(term) || term.includes(key)) {
        const dedupKey = `${match.fileId}:${match.nodeId}:${match.matchType}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          results.push(match);
          if (results.length >= limit) return results;
        }
      }
    }
  }

  return results;
}

/**
 * Normalize text into searchable terms (lowercase, split on whitespace/punctuation).
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,._\-:/\\]+/)
    .filter((t) => t.length > 0);
}

/**
 * Fuzzy search across multiple indexed documents.
 * Returns combined results sorted by relevance, deduplicated.
 */
export function searchAllContent(
  fileIndexes: Map<string, Map<string, ContentSearchMatch>>,
  query: string,
  limit = 20,
): ContentSearchMatch[] {
  if (!query.trim()) return [];

  const allResults: ContentSearchMatch[] = [];
  for (const [, index] of fileIndexes) {
    const results = searchContentIndex(index, query, limit);
    allResults.push(...results);
  }

  // Deduplicate
  const seen = new Set<string>();
  return allResults
    .filter((r) => {
      const key = `${r.fileId}:${r.nodeId}:${r.matchType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
