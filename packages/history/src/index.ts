/**
 * @varve/history — persistent revision history core (ADRs 0017-0046).
 *
 * Append-only operation log, immutable revision DAG, branch/checkpoint refs,
 * deterministic replay, content-addressed snapshots, tail recovery, and
 * legacy version convergence. Storage is backend-agnostic via `HistoryStore`
 * (memory implementation included; IndexedDB/SQLite backends are platform
 * follow-ups).
 */

export {
  buildEntityIndex,
  type EntityHistoryIndex,
  entityOperations,
} from './entityIndex';
export {
  importLegacyVersions,
  type LegacyImportResult,
  type LegacyVersionEntry,
  type LegacyVersionImport,
  validateImportedHistory,
} from './legacyImport';
export {
  type AppendOperationsInput,
  buildSegment,
  computeSegmentChecksum,
  LOG_SEGMENT_FORMAT_VERSION,
  type LogSegment,
  serializeSegmentContent,
  verifySegmentChecksum,
} from './log';
export {
  recoverTail,
  validateHistory,
} from './recovery';
export {
  applyStoredOperations,
  findReplayBase,
  hashOf,
  loadDocumentAt,
  positionAfter,
  positionBefore,
  ReplayError,
  replayAndVerify,
  replayToDocument,
  verifySegments,
} from './replay';
export {
  buildRevision,
  type CreateRevisionInput,
  createCheckpoint,
  createGenesisRevision,
  moveBranchHead,
  validateRevisionGraph,
  validateRevisionShape,
} from './revisions';
export {
  createSnapshot,
  DEFAULT_SNAPSHOT_POLICY,
  type SnapshotPolicy,
  type SnapshotRecord,
  SnapshotScheduler,
  type SnapshotStats,
  shouldSnapshot,
  snapshotToDocument,
} from './snapshots';
export {
  commitRevision,
  createMemoryHistoryStore,
  type HistoryStore,
  isIntegrityError,
  mintHistoryId,
  type RevisionCommit,
  type RevisionCommitResult,
} from './store';
export type {
  BranchRef,
  CheckpointRef,
  DocumentManifest,
  IntegrityIssue,
  LogPosition,
  RecoveryRef,
  RevisionAuthor,
  RevisionOrigin,
  RevisionRecord,
  StoredOperation,
  TailRecoveryReport,
  VerifyResult,
} from './types';
