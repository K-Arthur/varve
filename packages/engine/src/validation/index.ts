/**
 * Canonical measurement-record validation.
 *
 * Records that authorize routing or release claims are validated here, not in
 * the modules that display them.
 */
export type {
  ClaimTopic,
  DeclaredWorstCritical,
  MeasurementCase,
  MeasurementClaim,
  MeasurementDiagnostic,
  MeasurementDiagnosticCode,
  MeasurementIdentity,
  MeasurementMetricDeclaration,
  MeasurementOutcome,
  MeasurementRecord,
  MeasurementRecordStatus,
  MeasurementRuntimeIdentity,
  MeasurementValidationOptions,
  MetricAggregation,
  MetricDirection,
  MetricRole,
  RecomputedWorstCritical,
  VerificationClass,
  VerifiedMeasurementSummary,
  VerifiedQualityEvidence,
} from './measurementRecord';
export {
  toVerifiedQualityEvidence,
  validateMeasurementRecord,
} from './measurementRecord';
