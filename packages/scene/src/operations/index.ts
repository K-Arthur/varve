/**
 * Typed operation pipeline (ADR-0017/0018): registry, transaction
 * coordinator, and built-in operation families.
 */
export { registerBuiltinOperations } from './bootstrap';
export type {
  CapturedChange,
  CapturedChangeType,
  CapturedTextRanges,
  TransactionCapturePayload,
} from './ops/captureOps';
export type {
  MasterAssignPayload,
  MasterCreatePayload,
  MasterDeletePayload,
  MasterDuplicatePayload,
  MasterOverridePayload,
  MasterRemoveOverridePayload,
  MasterRenamePayload,
  MasterResetOverridesPayload,
  MasterSetAppliesToPayload,
} from './ops/masterOps';
export { isAllowedPropertyPath, type NodeCreatePayload } from './ops/nodeOps';
export type {
  PageCreatePayload,
  PageDeletePayload,
  PageLayoutPayload,
  PageMoveOnPasteboardPayload,
  PageRenamePayload,
  PageResizePayload,
} from './ops/pageOps';
export {
  affectedEntitiesOf,
  applyOperation,
  getOperation,
  hasOperation,
  listOperationTypes,
  migratePayload,
  preconditionFailure,
  registerOperation,
  summarizeOperation,
  validatePayload,
} from './registry';
export {
  type CommittedTransaction,
  createNestingGuard,
  createTransactionSession,
  type OperationRecord,
  type TransactionCoordinatorOptions,
  type TransactionSession,
} from './transaction';
// Alias: scene's ./governance also exports `ValidationResult`; the barrel
// alias keeps `export *` at the package index unambiguous.
export type { ValidationResult as OperationValidationResult } from './types';
export {
  DEFAULT_DISPATCHER_LIMITS,
  type DesignOperation,
  type DispatcherLimits,
  type OperationActor,
  type OperationActorKind,
  type OperationDefinition,
  type OperationInverseDescriptor,
  type OperationProvenance,
  type OperationSource,
  type SemanticSummary,
  type SummaryContext,
} from './types';
