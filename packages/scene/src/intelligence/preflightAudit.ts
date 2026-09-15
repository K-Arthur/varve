/**
 * Preflight Audit Mode
 *
 * Special audit mode for export preflight checks.
 * Runs export-specific rules and provides export readiness assessment.
 *
 * @module preflightAudit
 */

import type { AuditFinding, AuditSeverity } from '@varve/shared';
import type { AuditCache } from './auditCache';
import type { AuditPipeline, PipelineOptions } from './auditPipeline';

// ============================================================================
// Types
// ============================================================================

/**
 * Preflight check result.
 */
export interface PreflightCheckResult {
  /** Whether export is ready */
  ready: boolean;

  /** Blocking issues (must be fixed before export) */
  blocking: AuditFinding[];

  /** Warnings (should be fixed but won't block export) */
  warnings: AuditFinding[];

  /** Suggestions (optional improvements) */
  suggestions: AuditFinding[];

  /** Total issue count */
  totalIssues: number;

  /** Export type */
  exportType: string;

  /** Scan duration in milliseconds */
  durationMs: number;
}

/**
 * Preflight options.
 */
export interface PreflightOptions extends PipelineOptions {
  /** Export type (e.g., 'png', 'svg', 'pdf', 'code') */
  exportType: string;

  /** Whether to block export on errors */
  blockOnErrors?: boolean;

  /** Whether to block export on warnings */
  blockOnWarnings?: boolean;

  /** Maximum file size in bytes (for export checks) */
  maxFileSize?: number;

  /** Target resolution (for image exports) */
  targetResolution?: { width: number; height: number };

  /** Target color space (for image exports) */
  targetColorSpace?: 'srgb' | 'p3' | 'gray';
}

// ============================================================================
// Preflight Audit Manager
// ============================================================================

/**
 * Preflight audit manager.
 */
export class PreflightAuditManager {
  private pipeline: AuditPipeline;

  constructor(pipeline: AuditPipeline, _cache: AuditCache) {
    this.pipeline = pipeline;
  }

  /**
   * Run preflight audit for export.
   *
   * @param document - The document to audit
   * @param options - Preflight options
   * @returns Preflight check result
   */
  async runPreflight(document: unknown, options: PreflightOptions): Promise<PreflightCheckResult> {
    const startTime = Date.now();

    // Configure pipeline for preflight
    const pipelineOptions: PipelineOptions = {
      ...options,
      includeCodegenAnalysis: true,
      includePixelAnalysis: false, // Pixel analysis is expensive, skip for preflight
    };

    // Run pipeline
    const result = await this.pipeline.run(document, pipelineOptions);

    // Categorize findings
    const blocking: AuditFinding[] = [];
    const warnings: AuditFinding[] = [];
    const suggestions: AuditFinding[] = [];

    for (const finding of result.findings) {
      if (finding.severity === 'error') {
        blocking.push(finding);
      } else if (finding.severity === 'warning') {
        warnings.push(finding);
      } else {
        suggestions.push(finding);
      }
    }

    // Determine readiness
    const ready = this.isExportReady(blocking, warnings, options);

    const durationMs = Date.now() - startTime;

    return {
      ready,
      blocking,
      warnings,
      suggestions,
      totalIssues: result.findings.length,
      exportType: options.exportType,
      durationMs,
    };
  }

  /**
   * Check if export is ready based on issues and options.
   *
   * @param blocking - Blocking issues
   * @param warnings - Warning issues
   * @param options - Preflight options
   * @returns Whether export is ready
   */
  private isExportReady(
    blocking: AuditFinding[],
    warnings: AuditFinding[],
    options: PreflightOptions,
  ): boolean {
    // Always block on errors if configured
    if (options.blockOnErrors && blocking.length > 0) {
      return false;
    }

    // Block on warnings if configured
    if (options.blockOnWarnings && warnings.length > 0) {
      return false;
    }

    // Default: only block on errors
    return blocking.length === 0;
  }

  /**
   * Get export readiness summary.
   *
   * @param result - Preflight check result
   * @returns Human-readable summary
   */
  getSummary(result: PreflightCheckResult): string {
    if (result.ready) {
      return `Export ready for ${result.exportType}`;
    }

    const parts: string[] = [];

    if (result.blocking.length > 0) {
      parts.push(
        `${result.blocking.length} blocking issue${result.blocking.length > 1 ? 's' : ''}`,
      );
    }

    if (result.warnings.length > 0) {
      parts.push(`${result.warnings.length} warning${result.warnings.length > 1 ? 's' : ''}`);
    }

    return `Cannot export: ${parts.join(', ')}`;
  }

  /**
   * Get export readiness badge color.
   *
   * @param result - Preflight check result
   * @returns CSS color
   */
  getBadgeColor(result: PreflightCheckResult): string {
    if (result.ready) {
      return '#22c55e'; // Green
    }

    if (result.blocking.length > 0) {
      return '#ef4444'; // Red
    }

    if (result.warnings.length > 0) {
      return '#f59e0b'; // Orange
    }

    return '#3b82f6'; // Blue
  }
}

// ============================================================================
// Preflight Utils
// ============================================================================

/**
 * Check if a finding is export-blocking.
 *
 * @param finding - The finding to check
 * @returns Whether the finding blocks export
 */
export function isExportBlocking(finding: AuditFinding): boolean {
  return (
    finding.severity === 'error' ||
    (finding.severity === 'warning' && finding.category === 'codegen')
  );
}

/**
 * Get export-specific severity for a finding.
 *
 * @param finding - The finding
 * @param _exportType - Export type
 * @returns Export-specific severity
 */
export function getExportSeverity(finding: AuditFinding, _exportType: string): AuditSeverity {
  // Codegen findings are always errors in preflight
  if (finding.category === 'codegen') {
    return 'error';
  }

  // Default to original severity
  return finding.severity;
}

/**
 * Filter findings for export preflight.
 *
 * @param findings - All findings
 * @param _exportType - Export type
 * @returns Filtered findings
 */
export function filterForExport(findings: AuditFinding[], _exportType: string): AuditFinding[] {
  return findings.filter((finding) => {
    // Include if finding applies to export mode
    if (finding.applicableModes.includes('export-preflight')) {
      return true;
    }

    // Include if finding applies to all modes
    if (finding.applicableModes.length === 0) {
      return true;
    }

    return false;
  });
}
