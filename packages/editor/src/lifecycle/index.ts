export {
  type FinalizerRunner,
  type LifecycleMarker,
  TerminationCoordinator,
  type TerminationCoordinatorDeps,
  type TerminationDialogs,
} from './coordinator';
export {
  collectUnsavedDocuments,
  displayName,
  hasUnsavedDocuments,
  scopeForIntent,
  scopeSessionIds,
} from './dirtyRegistry';
export { createFinalizerRegistry, type FinalizerRegistry } from './finalizers';
export {
  getLifecycleCoordinator,
  getLifecycleFinalizeHandler,
  installLifecycleCoordinator,
  setLifecycleFinalizeHandler,
  uninstallLifecycleCoordinator,
} from './global';
export { LifecycleProvider } from './LifecycleProvider';
export {
  CLEAN_SHUTDOWN_KEY,
  getSharedShutdownMarker,
  resetSharedShutdownMarker,
  ShutdownMarker,
  type ShutdownMarkerStorage,
} from './lifecycleMarker';
export { categorizeFailure, createSavePlan, type SavePlan, type SavePlanResult } from './savePlan';
export { TerminationDialogHost } from './TerminationDialogHost';
export type {
  DialogOutcome,
  DirtyScope,
  EditorLifecycleApi,
  FailureChoice,
  Finalizer,
  PromptKind,
  PromptRequest,
  QuitDocumentResult,
  SaveFailureCategory,
  SaveOutcome,
  TerminationIntent,
  TerminationPhase,
  TerminationResult,
  TerminationState,
  TerminationTraceEvent,
  UnsavedChoice,
  UnsavedDocument,
} from './types';
