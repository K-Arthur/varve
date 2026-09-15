import type { AuditFinding } from '@varve/scene';

export interface SerialisableScanInput {
  document: unknown;
  nodeIds: string[];
  ruleIds: string[];
  revision: number;
}

export interface ScanProgress {
  completed: number;
  total: number;
  currentRule: string;
  elapsed: number;
  estimatedRemaining?: number;
}

export interface ScanResult {
  findings: AuditFinding[];
  timings: Record<string, number>;
  failures: number;
  revision: number;
  aborted: boolean;
}

export interface ScanResultChunk {
  findings: AuditFinding[];
  completed: number;
  total: number;
  currentRule: string;
}
