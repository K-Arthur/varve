/**
 * Failure classification for the text-discovery panel.
 *
 * A memory denial is a policy decision with a reason; a timeout, a cancellation,
 * and a runtime crash all need different copy and different affordances. The
 * classification is pure so it can be tested without a Worker or a model.
 */

export type DiscoveryFailureKind = 'cancelled' | 'timeout' | 'refused' | 'failed';

export interface DiscoveryFailure {
  kind: DiscoveryFailureKind;
  /** Message the panel shows; empty for `cancelled`, which has no error state. */
  message: string;
}

const WASM_ADMISSION_PREFIX = /^Model exceeds safe WASM memory limit\.\s*/;

export function classifyDiscoveryFailure(input: {
  message?: string;
  aborted: boolean;
  timedOut: boolean;
  /** Soft deadline in minutes, used in the timeout copy. */
  deadlineMinutes: number;
}): DiscoveryFailure {
  const message = input.message ?? '';
  if (input.timedOut) {
    return {
      kind: 'timeout',
      message: `Text discovery did not finish within ${input.deadlineMinutes} minutes on this device. The detector is a background-scale model; use point or box Object Selection for an immediate result.`,
    };
  }
  if (input.aborted) {
    return { kind: 'cancelled', message: '' };
  }
  if (/exceeds safe WASM memory limit/i.test(message)) {
    return {
      kind: 'refused',
      message: `Text discovery was not started: the detector is a background-scale model. ${message.replace(WASM_ADMISSION_PREFIX, '')}`,
    };
  }
  if (/insufficient-memory|out_of_memory|allocation failed/i.test(message)) {
    return {
      kind: 'refused',
      message:
        'Text discovery needs more memory than this session can reserve. Use point or box Object Selection instead.',
    };
  }
  return { kind: 'failed', message: `Text discovery failed: ${message}` };
}
