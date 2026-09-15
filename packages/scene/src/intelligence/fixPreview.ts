/**
 * Fix Preview System
 *
 * Provides preview functionality for audit fixes.
 * Allows users to see the effects of a fix before applying it.
 *
 * @module fixPreview
 */

import type { AuditFinding, AuditFix } from '@varve/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * Fix preview result.
 */
export interface FixPreviewResult {
  /** Whether the preview was successful */
  success: boolean;

  /** Previewed document (clone with fix applied) */
  previewDocument: unknown;

  /** Changes made by the fix */
  changes: FixChange[];

  /** Error if preview failed */
  error?: string;
}

/**
 * Change made by a fix.
 */
export interface FixChange {
  /** Type of change */
  type: 'property' | 'node' | 'style' | 'delete' | 'add';

  /** Affected node ID */
  nodeId: string;

  /** Property name (for property changes) */
  property?: string;

  /** Old value */
  oldValue?: unknown;

  /** New value */
  newValue?: unknown;

  /** Description of the change */
  description: string;
}

/**
 * Fix preview options.
 */
export interface FixPreviewOptions {
  /** Include detailed change information */
  includeDetails?: boolean;

  /** Limit the number of changes to return */
  maxChanges?: number;
}

// ============================================================================
// Fix Preview Manager
// ============================================================================

/**
 * Fix preview manager.
 */
export class FixPreviewManager {
  private previewCache: Map<string, FixPreviewResult> = new Map();

  /**
   * Preview a fix.
   *
   * @param finding - The finding to preview the fix for
   * @param fixId - The ID of the fix to preview
   * @param document - The current document
   * @param options - Preview options
   * @returns Preview result
   */
  async previewFix(
    finding: AuditFinding,
    fixId: string,
    document: unknown,
    options: FixPreviewOptions = {},
  ): Promise<FixPreviewResult> {
    const cacheKey = `${finding.findingId}:${fixId}:${document ? JSON.stringify(document) : ''}`;

    // Check cache
    if (this.previewCache.has(cacheKey)) {
      return this.previewCache.get(cacheKey)!;
    }

    // Find the fix
    const fix = finding.fixes.find((f) => f.id === fixId);
    if (!fix) {
      return {
        success: false,
        previewDocument: document,
        changes: [],
        error: `Fix ${fixId} not found`,
      };
    }

    try {
      // Clone the document
      const previewDocument = this.cloneDocument(document);

      // Track changes
      const changes: FixChange[] = [];

      // Apply the fix to the clone
      const result = fix.apply(previewDocument);

      if (result === null) {
        // Fix would have no effect
        return {
          success: true,
          previewDocument,
          changes: [],
        };
      }

      // Analyze changes
      if (options.includeDetails) {
        const detectedChanges = this.detectChanges(document, result, finding.nodeIds);
        changes.push(...detectedChanges);
      }

      // Limit changes if requested
      const limitedChanges = options.maxChanges ? changes.slice(0, options.maxChanges) : changes;

      const previewResult: FixPreviewResult = {
        success: true,
        previewDocument: result,
        changes: limitedChanges,
      };

      // Cache the result
      this.previewCache.set(cacheKey, previewResult);

      return previewResult;
    } catch (error) {
      return {
        success: false,
        previewDocument: document,
        changes: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Preview multiple fixes.
   *
   * @param finding - The finding to preview fixes for
   * @param document - The current document
   * @param options - Preview options
   * @returns Map of fix IDs to preview results
   */
  async previewAllFixes(
    finding: AuditFinding,
    document: unknown,
    options: FixPreviewOptions = {},
  ): Promise<Map<string, FixPreviewResult>> {
    const results = new Map<string, FixPreviewResult>();

    for (const fix of finding.fixes) {
      const result = await this.previewFix(finding, fix.id, document, options);
      results.set(fix.id, result);
    }

    return results;
  }

  /**
   * Clear the preview cache.
   */
  clearCache(): void {
    this.previewCache.clear();
  }

  /**
   * Clear cache for a specific finding.
   *
   * @param findingId - The finding ID
   */
  clearCacheForFinding(findingId: string): void {
    for (const key of this.previewCache.keys()) {
      if (key.startsWith(findingId)) {
        this.previewCache.delete(key);
      }
    }
  }

  /**
   * Clone a document for preview.
   *
   * @param document - The document to clone
   * @returns Cloned document
   */
  private cloneDocument(document: unknown): unknown {
    // Deep clone the document
    return JSON.parse(JSON.stringify(document));
  }

  /**
   * Detect changes between two documents.
   *
   * @param _original - Original document
   * @param _modified - Modified document
   * @param nodeIds - Node IDs to check
   * @returns Detected changes
   */
  private detectChanges(_original: unknown, _modified: unknown, nodeIds: string[]): FixChange[] {
    const changes: FixChange[] = [];

    // This is a simplified implementation
    // A real implementation would do a deep diff

    for (const nodeId of nodeIds) {
      // In a real implementation, we would compare the node state
      // between original and modified documents
      // For now, we'll add a placeholder change

      changes.push({
        type: 'property',
        nodeId,
        description: 'Property changed',
      });
    }

    return changes;
  }
}

// ============================================================================
// Fix Preview Utils
// ============================================================================

/**
 * Check if a fix is previewable.
 *
 * @param fix - The fix to check
 * @returns Whether the fix is previewable
 */
export function isFixPreviewable(fix: AuditFix): boolean {
  return fix.previewable !== false;
}

/**
 * Get the number of changes in a preview result.
 *
 * @param preview - The preview result
 * @returns Number of changes
 */
export function getChangeCount(preview: FixPreviewResult): number {
  return preview.changes.length;
}

/**
 * Check if a preview has any changes.
 *
 * @param preview - The preview result
 * @returns Whether the preview has changes
 */
export function hasChanges(preview: FixPreviewResult): boolean {
  return preview.changes.length > 0;
}

/**
 * Get a summary of changes.
 *
 * @param preview - The preview result
 * @returns Change summary
 */
export function getChangeSummary(preview: FixPreviewResult): string {
  if (!hasChanges(preview)) {
    return 'No changes';
  }

  const changesByType = new Map<string, number>();
  for (const change of preview.changes) {
    const count = changesByType.get(change.type) || 0;
    changesByType.set(change.type, count + 1);
  }

  const parts: string[] = [];
  for (const [type, count] of changesByType.entries()) {
    parts.push(`${count} ${type}${count > 1 ? 's' : ''}`);
  }

  return parts.join(', ');
}
