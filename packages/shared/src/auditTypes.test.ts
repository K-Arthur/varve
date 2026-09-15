/**
 * Tests for audit types and utilities
 */

import { describe, expect, it } from 'vitest';
import {
  type AuditFinding,
  classifyConfidence,
  generateFindingId,
  mapLegacySeverity,
  sceneFindingToShared,
  serializeEvidence,
  sharedFindingToSceneShape,
} from './auditTypes';

describe('generateFindingId', () => {
  it('should generate a stable ID for the same inputs', () => {
    const id1 = generateFindingId('rule-1', 'node-1', { key: 'value' });
    const id2 = generateFindingId('rule-1', 'node-1', { key: 'value' });
    expect(id1).toBe(id2);
  });

  it('should generate different IDs for different inputs', () => {
    const id1 = generateFindingId('rule-1', 'node-1', { key: 'value' });
    const id2 = generateFindingId('rule-2', 'node-1', { key: 'value' });
    expect(id1).not.toBe(id2);
  });

  it('should handle empty evidence', () => {
    const id = generateFindingId('rule-1', 'node-1', {});
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });
});

describe('serializeEvidence', () => {
  it('should serialize evidence to a string', () => {
    const evidence = { contrast: 3.5, fontSize: 16 };
    const serialized = serializeEvidence(evidence);
    expect(typeof serialized).toBe('string');
  });

  it('should produce consistent output for same input', () => {
    const evidence = { contrast: 3.5, fontSize: 16 };
    const s1 = serializeEvidence(evidence);
    const s2 = serializeEvidence(evidence);
    expect(s1).toBe(s2);
  });
});

describe('mapLegacySeverity', () => {
  it('should map error severity', () => {
    expect(mapLegacySeverity('error')).toBe('error');
  });

  it('should map warning severity', () => {
    expect(mapLegacySeverity('warning')).toBe('warning');
  });

  it('should map info severity to suggestion', () => {
    expect(mapLegacySeverity('info')).toBe('suggestion');
  });

  it('should handle unknown severity', () => {
    expect(mapLegacySeverity('unknown' as any)).toBe('advisory');
  });
});

describe('sceneFindingToShared', () => {
  it('converts a scene finding to shared format preserving key fields', () => {
    const sceneFinding = {
      ruleId: 'contrast/aa-fail',
      ruleVersion: 2,
      findingId: 'abc123',
      severity: 'error' as const,
      confidence: 0.95,
      message: 'Low contrast',
      detail: 'Text has contrast ratio 2.5:1',
      nodeId: 'node-1',
      nodeIds: ['node-1'],
      pageId: 'page-1',
      evidence: { ratio: 2.5 },
      cost: 'cheap',
      workspaceApplicable: ['design', 'print'],
      autoFixAvailable: true,
      generatedAt: 1000,
      revision: 5,
      stale: false,
      resolved: false,
    };

    const shared = sceneFindingToShared(sceneFinding);

    expect(shared.findingId).toBe('abc123');
    expect(shared.ruleId).toBe('contrast/aa-fail');
    expect(shared.ruleVersion).toBe('2');
    expect(shared.severity).toBe('error');
    expect(shared.confidence).toBe(0.95);
    expect(shared.message).toBe('Low contrast');
    expect(shared.detail).toBe('Text has contrast ratio 2.5:1');
    expect(shared.nodeIds).toEqual(['node-1']);
    expect(shared.evidence).toEqual({ ratio: 2.5 });
    expect(shared.fixCapability).toBe('automatic');
    expect(shared.applicableWorkspaces).toEqual(['design', 'print']);
    expect(shared.documentRevision).toBe(5);
    expect(shared.timestamp).toBe(1000);
    expect(shared.stale).toBe(false);
    expect(shared.resolved).toBe(false);
  });

  it('handles document-level finding with no nodeId', () => {
    const sceneFinding = {
      ruleId: 'print/missing-bleed',
      ruleVersion: 1,
      findingId: 'def456',
      severity: 'warning' as const,
      confidence: 1.0,
      message: 'Missing bleed',
      cost: 'moderate',
      workspaceApplicable: ['print'],
      autoFixAvailable: false,
    };

    const shared = sceneFindingToShared(sceneFinding);

    expect(shared.nodeIds).toEqual([]);
    expect(shared.fixCapability).toBe('none');
  });

  it('uses nodeIds when provided', () => {
    const sceneFinding = {
      ruleId: 'linter/duplicate',
      ruleVersion: 1,
      findingId: 'ghi789',
      severity: 'suggestion' as const,
      confidence: 0.8,
      message: 'Duplicate styles',
      nodeIds: ['node-1', 'node-2'],
      cost: 'cheap',
      workspaceApplicable: [],
      autoFixAvailable: false,
    };

    const shared = sceneFindingToShared(sceneFinding);

    expect(shared.nodeIds).toEqual(['node-1', 'node-2']);
  });
});

describe('sharedFindingToSceneShape', () => {
  it('converts shared finding back to scene shape', () => {
    const shared: AuditFinding = {
      findingId: 'abc123',
      ruleId: 'contrast/aa-fail',
      ruleVersion: '2',
      severity: 'error',
      category: 'contrast',
      confidence: 0.95,
      nodeIds: ['node-1'],
      message: 'Low contrast',
      detail: 'Text has contrast ratio 2.5:1',
      evidence: { ratio: 2.5 },
      fixCapability: 'automatic',
      fixes: [],
      applicableWorkspaces: ['design'],
      applicableModes: [],
      applicableNodeKinds: [],
      documentRevision: 5,
      timestamp: 1000,
      stale: false,
      resolved: false,
      suppressionEligible: true,
      suppressionScope: 'finding',
      cost: 'moderate',
      scope: 'document',
      scanId: 1,
    };

    const scene = sharedFindingToSceneShape(shared);

    expect(scene.ruleId).toBe('contrast/aa-fail');
    expect(scene.ruleVersion).toBe(2);
    expect(scene.autoFixAvailable).toBe(true);
    expect(scene.cost).toBe('moderate');
    expect(scene.workspaceApplicable).toEqual(['design']);
    expect(scene.blocking).toBe(true);
    expect(scene.revision).toBe(5);
    expect(scene.stale).toBe(false);
    expect(scene.resolved).toBe(false);
    expect(scene.suppressionEligible).toBe(true);
  });
});

describe('classifyConfidence', () => {
  it('should classify certain confidence', () => {
    expect(classifyConfidence(0.95)).toBe('certain');
    expect(classifyConfidence(1.0)).toBe('certain');
  });

  it('should classify probable confidence', () => {
    expect(classifyConfidence(0.7)).toBe('probable');
    expect(classifyConfidence(0.8)).toBe('probable');
  });

  it('should classify uncertain confidence', () => {
    expect(classifyConfidence(0.5)).toBe('uncertain');
    expect(classifyConfidence(0.69)).toBe('uncertain');
  });

  it('should clamp values to valid range', () => {
    expect(classifyConfidence(1.5)).toBe('certain');
    expect(classifyConfidence(-0.5)).toBe('speculative');
  });
});
