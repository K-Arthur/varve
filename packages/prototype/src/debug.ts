/**
 * Debug and logging system for prototype playback.
 *
 * Records trigger fires, action executions, state changes, navigation events,
 * and validation issues during prototype playback. Exposed as a console-like
 * interface in the prototype player.
 *
 * Research basis: Figma prototype debug console (event log, variable inspector),
 * Framer state viewer, browser DevTools Console.
 */

import type { ActionResult } from './actions';
import type { PrototypeEvent } from './triggers';
import type { NodeId } from './types';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: 'trigger' | 'action' | 'navigation' | 'state' | 'validation' | 'system';
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Prototype debug console.
 */
export class PrototypeDebugConsole {
  entries: LogEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  /**
   * Log a trigger fire event.
   */
  logTrigger(event: PrototypeEvent, interactionId: string, nodeId: NodeId): void {
    this.addEntry('info', 'trigger', `Trigger fired: ${event.type}`, {
      event,
      interactionId,
      nodeId,
    });
  }

  /**
   * Log an action execution.
   */
  logAction(action: ActionResult, interactionId: string): void {
    let message = `Action: ${action.kind}`;
    const details: Record<string, unknown> = { interactionId };

    switch (action.kind) {
      case 'navigateTo':
        message += ` → ${action.targetId}`;
        details.targetId = action.targetId;
        break;
      case 'openOverlay':
        message += ` → ${action.targetId}`;
        details.targetId = action.targetId;
        break;
      case 'closeOverlay':
        message += ` → ${action.overlayId}`;
        break;
      case 'setVariable':
        message += `: ${action.variableId} = ${action.value}`;
        details.variableId = action.variableId;
        details.value = action.value;
        break;
      case 'toggleVariable':
        message += `: ${action.variableId} → ${action.newValue}`;
        details.variableId = action.variableId;
        details.newValue = action.newValue;
        break;
      case 'goBack':
        message = 'Going back in navigation';
        break;
    }

    this.addEntry('info', 'action', message, details);
  }

  /**
   * Log a navigation event.
   */
  logNavigation(fromScreen: NodeId, toScreen: NodeId): void {
    this.addEntry('info', 'navigation', `Navigated: ${fromScreen} → ${toScreen}`, {
      fromScreen,
      toScreen,
    });
  }

  /**
   * Log a state change.
   */
  logStateChange(variableId: string, oldValue: unknown, newValue: unknown): void {
    this.addEntry('debug', 'state', `Variable "${variableId}": ${oldValue} → ${newValue}`, {
      variableId,
      oldValue,
      newValue,
    });
  }

  /**
   * Log a validation issue.
   */
  logValidation(issue: { code: string; severity: string; message: string }): void {
    this.addEntry(
      issue.severity === 'error' ? 'error' : 'warn',
      'validation',
      `[${issue.code}] ${issue.message}`,
      issue,
    );
  }

  /**
   * Log a system message.
   */
  log(level: LogLevel, message: string, details?: Record<string, unknown>): void {
    this.addEntry(level, 'system', message, details);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Export log as JSON.
   */
  exportJSON(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  private addEntry(
    level: LogLevel,
    category: LogEntry['category'],
    message: string,
    details?: Record<string, unknown>,
  ): void {
    this.entries.push({
      timestamp: Date.now(),
      level,
      category,
      message,
      details,
    });

    // Trim to max entries
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }
}
