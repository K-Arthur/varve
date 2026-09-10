/**
 * Session protocol + broker public surface (ADR-0023/0024/0025).
 */

export type {
  BrokerCommandResult,
  BrokerOutcome,
  SessionBrokerOptions,
} from './broker';
export { SessionBroker } from './broker';
export type {
  CommandAckPayload,
  CommandAvailability,
  CommandRejectPayload,
  CommandSubmitPayload,
  EnvelopeValidation,
  EnvelopeValidationContext,
  GenerationResetPayload,
  HeartbeatPayload,
  OpenDocumentDescriptor,
  ResyncRequestPayload,
  SessionEnvelope,
  SessionMessageKind,
  SessionMessageTarget,
  SessionPatchPayload,
  SessionRegistration,
  SessionSnapshotData,
  SessionSnapshotPayload,
  SessionWindowRole,
  SnapshotRequestPayload,
  SubmitEditorCommand,
  TransferAbortPayload,
  TransferAckPayload,
  TransferBeginPayload,
  TransferCommitPayload,
  WindowClosingPayload,
  WindowHydratedPayload,
  WindowReadyPayload,
} from './protocol';
export {
  createEnvelope,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  MAX_ACKNOWLEDGED_COMMANDS,
  MAX_ENVELOPE_PAYLOAD_BYTES,
  MAX_PANEL_STATE_BYTES,
  PAYLOAD_VALIDATORS,
  payloadByteSize,
  SESSION_MESSAGE_KINDS,
  SESSION_PROTOCOL_VERSION,
  validateEnvelope,
  validateSubmitEditorCommand,
} from './protocol';
