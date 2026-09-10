/**
 * Command routing for detached panels (ADR-0212).
 *
 * Auxiliary windows submit commands through a typed command client.
 * The primary window validates and executes them once, updating the
 * canonical undo stack. Commands are idempotent where retries are possible.
 *
 * This module defines the command submission interface and validation.
 * The actual execution happens in the primary window's command authority.
 */

// ---------------------------------------------------------------------------
// Command types
// ---------------------------------------------------------------------------

export type CommandStatus = 'pending' | 'acknowledged' | 'rejected' | 'expired';

export interface SubmittedCommand {
  id: string;
  commandType: string;
  originWindowId: string;
  originPanelInstanceId: string;
  activeDocumentId: string;
  expectedRevision?: number;
  payload: unknown;
  status: CommandStatus;
  submittedAt: number;
  acknowledgedAt?: number;
  reason?: string;
}

export interface CommandAcknowledgement {
  commandId: string;
  accepted: boolean;
  reason?: string;
  newRevision?: number;
}

// ---------------------------------------------------------------------------
// Command validation
// ---------------------------------------------------------------------------

export interface CommandDefinition {
  type: string;
  /** Whether this command modifies the document. */
  mutatesDocument: boolean;
  /** Required panel capability to execute this command. */
  requiredCapability?: string;
  /** Whether this command is idempotent. */
  idempotent: boolean;
  /** Max payload size in bytes. */
  maxPayloadBytes: number;
}

/**
 * Registry of allowed command types. Only commands in this registry
 * may be submitted from auxiliary windows.
 */
const commandRegistry = new Map<string, CommandDefinition>();

export function registerCommand(def: CommandDefinition): void {
  commandRegistry.set(def.type, def);
}

export function getCommandDefinition(type: string): CommandDefinition | undefined {
  return commandRegistry.get(type);
}

export function resetCommandRegistry(): void {
  commandRegistry.clear();
}

// ---------------------------------------------------------------------------
// Built-in command definitions
// ---------------------------------------------------------------------------

export function registerBuiltinCommands(): void {
  const commands: CommandDefinition[] = [
    {
      type: 'updateNodeProperties',
      mutatesDocument: true,
      idempotent: false,
      maxPayloadBytes: 4096,
    },
    {
      type: 'setSelection',
      mutatesDocument: false,
      idempotent: true,
      maxPayloadBytes: 1024,
    },
    {
      type: 'renameNode',
      mutatesDocument: true,
      idempotent: false,
      maxPayloadBytes: 512,
    },
    {
      type: 'deleteNodes',
      mutatesDocument: true,
      idempotent: false,
      maxPayloadBytes: 2048,
    },
    {
      type: 'reorderNodes',
      mutatesDocument: true,
      idempotent: false,
      maxPayloadBytes: 2048,
    },
    {
      type: 'toggleVisibility',
      mutatesDocument: true,
      idempotent: true,
      maxPayloadBytes: 256,
    },
    {
      type: 'toggleLock',
      mutatesDocument: true,
      idempotent: true,
      maxPayloadBytes: 256,
    },
    {
      type: 'createNode',
      mutatesDocument: true,
      idempotent: false,
      maxPayloadBytes: 4096,
    },
    {
      type: 'updateVariable',
      mutatesDocument: true,
      idempotent: false,
      maxPayloadBytes: 2048,
    },
    {
      type: 'undo',
      mutatesDocument: true,
      idempotent: false,
      maxPayloadBytes: 0,
    },
    {
      type: 'redo',
      mutatesDocument: true,
      idempotent: false,
      maxPayloadBytes: 0,
    },
  ];
  for (const def of commands) {
    registerCommand(def);
  }
}

// ---------------------------------------------------------------------------
// Command validation
// ---------------------------------------------------------------------------

export interface CommandValidationError {
  field: string;
  message: string;
}

/**
 * Validate a command submission before sending.
 */
export function validateCommandSubmission(options: {
  commandType: string;
  originWindowId: string;
  originPanelInstanceId: string;
  activeDocumentId: string;
  payload: unknown;
  panelCapabilities?: { requiresCanvas?: boolean; requiresRenderer?: boolean };
}): CommandValidationError[] {
  const errors: CommandValidationError[] = [];
  const { commandType, originWindowId, originPanelInstanceId, activeDocumentId, payload } = options;

  if (!commandType) {
    errors.push({ field: 'commandType', message: 'must be non-empty' });
  }

  const def = getCommandDefinition(commandType);
  if (!def) {
    errors.push({ field: 'commandType', message: `'${commandType}' is not a registered command` });
    return errors;
  }

  if (!originWindowId) {
    errors.push({ field: 'originWindowId', message: 'must be non-empty' });
  }

  if (!originPanelInstanceId) {
    errors.push({ field: 'originPanelInstanceId', message: 'must be non-empty' });
  }

  if (!activeDocumentId) {
    errors.push({ field: 'activeDocumentId', message: 'must be non-empty for document commands' });
  }

  // Payload size check
  if (def.maxPayloadBytes > 0) {
    const payloadSize = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    if (payloadSize > def.maxPayloadBytes) {
      errors.push({
        field: 'payload',
        message: `payload size ${payloadSize} exceeds limit ${def.maxPayloadBytes}`,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Command client (used by auxiliary windows)
// ---------------------------------------------------------------------------

export class CommandClient {
  private pendingCommands = new Map<string, SubmittedCommand>();
  private sequenceCounter = 0;
  private readonly maxPending: number;

  constructor(
    private readonly windowId: string,
    private readonly sendFn: (eventId: string, payload: unknown) => void,
    maxPending = 50,
  ) {
    this.maxPending = maxPending;
  }

  /**
   * Submit a command to the primary window's command authority.
   * Returns the command id for tracking.
   */
  submit(options: {
    commandType: string;
    panelInstanceId: string;
    activeDocumentId: string;
    payload: unknown;
    expectedRevision?: number;
  }): string {
    if (this.pendingCommands.size >= this.maxPending) {
      throw new Error(`too many pending commands (${this.maxPending})`);
    }

    this.sequenceCounter += 1;
    const commandId = `cmd-${this.windowId}-${this.sequenceCounter}-${Date.now().toString(36)}`;

    const command: SubmittedCommand = {
      id: commandId,
      commandType: options.commandType,
      originWindowId: this.windowId,
      originPanelInstanceId: options.panelInstanceId,
      activeDocumentId: options.activeDocumentId,
      expectedRevision: options.expectedRevision,
      payload: options.payload,
      status: 'pending',
      submittedAt: Date.now(),
    };

    this.pendingCommands.set(commandId, command);

    this.sendFn('submit-command', {
      kind: 'submit-command',
      ...command,
    });

    return commandId;
  }

  /**
   * Handle an acknowledgement from the primary window.
   */
  handleAck(ack: CommandAcknowledgement): void {
    const cmd = this.pendingCommands.get(ack.commandId);
    if (!cmd) return; // unknown or already processed

    cmd.status = ack.accepted ? 'acknowledged' : 'rejected';
    cmd.acknowledgedAt = Date.now();
    cmd.reason = ack.reason;

    // Clean up after a delay (keep for duplicate detection)
    setTimeout(() => {
      this.pendingCommands.delete(ack.commandId);
    }, 5000);
  }

  /**
   * Check if a specific command has been acknowledged.
   */
  getCommandStatus(commandId: string): CommandStatus | undefined {
    return this.pendingCommands.get(commandId)?.status;
  }

  /**
   * Get all pending commands (for diagnostics).
   */
  getPendingCommands(): SubmittedCommand[] {
    return [...this.pendingCommands.values()];
  }

  /**
   * Clear expired commands (older than timeout).
   */
  clearExpired(timeoutMs = 30000): number {
    const now = Date.now();
    let cleared = 0;
    for (const [id, cmd] of this.pendingCommands) {
      if (now - cmd.submittedAt > timeoutMs) {
        cmd.status = 'expired';
        this.pendingCommands.delete(id);
        cleared++;
      }
    }
    return cleared;
  }

  /** Reset all state (tests only). */
  reset(): void {
    this.pendingCommands.clear();
    this.sequenceCounter = 0;
  }
}
