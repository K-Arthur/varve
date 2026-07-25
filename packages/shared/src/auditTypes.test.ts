/**
 * Tests for audit types and utilities
 */

import { describe, expect, it } from 'vitest';
import {
  generateFindingId,
  serializeEvidence,
  mapLegacySeverity,
  classifyConfidence,
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

describe('classifyConfidence', () => {
  it('should classify high confidence', () => {
    expect(classifyConfidence(0.95)).toBe('high');
    expect(classifyConfidence(1.0)).toBe('high');
  });

  it('should classify medium confidence', () => {
    expect(classifyConfidence(0.7)).toBe('medium');
    expect(classifyConfidence(0.8)).toBe('medium');
  });

  it('should classify low confidence', () => {
    expect(classifyConfidence(0.3)).toBe('low');
    expect(classifyConfidence(0.5)).toBe('low');
  });

  it('should clamp values to valid range', () => {
    expect(classifyConfidence(1.5)).toBe('high');
    expect(classifyConfidence(-0.5)).toBe('low');
  });
});
