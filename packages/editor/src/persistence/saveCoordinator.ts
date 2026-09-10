/**
 * @varve/editor — per-document save coordinator.
 *
 * Serializes every save request on a document and coalesces redundant
 * requests, so Ctrl+S / Ctrl+S / Ctrl+S never produces three competing
 * writes:
 *
 *   revision 10 saving
 *   revision 11 requested
 *   revision 12 requested
 *   → finish 10 → skip obsolete 11 → save latest 12
 *
 * Coalescing applies only to plain 'save' intents; 'save-as' and 'save-copy'
 * always run because they carry a deliberate destination choice. Skipped
 * requests resolve with the outcome of the final run (their work was
 * superseded by the newer revision, so the final write covers them).
 */
import { isCoalescibleIntent, type SaveIntent, type SaveOutcome } from './saveTypes';

export interface SaveCoordinator {
  /** Queue a save request; resolves with the outcome covering it. */
  request(intent: SaveIntent): Promise<SaveOutcome>;
  /** True while a save is running or queued. */
  isRunning(): boolean;
}

type RunSave = (intent: SaveIntent) => Promise<SaveOutcome>;

export function createSaveCoordinator(run: RunSave): SaveCoordinator {
  const queue: Array<{ intent: SaveIntent; resolve: (o: SaveOutcome) => void }> = [];
  let running = false;

  const pump = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const head = queue[0];
        if (!head) break;
        if (isCoalescibleIntent(head.intent) && queue.length > 1) {
          const group: Array<{ intent: SaveIntent; resolve: (o: SaveOutcome) => void }> = [];
          while (queue.length > 0 && isCoalescibleIntent(queue[0]!.intent)) {
            group.push(queue.shift() as { intent: SaveIntent; resolve: (o: SaveOutcome) => void });
          }
          const latest = group[group.length - 1];
          if (!latest) break;
          const outcome = await run(latest.intent);
          for (const entry of group) entry.resolve(outcome);
        } else {
          queue.shift();
          const outcome = await run(head.intent);
          head.resolve(outcome);
        }
      }
    } finally {
      running = false;
      if (queue.length > 0) void pump();
    }
  };

  return {
    request(intent: SaveIntent): Promise<SaveOutcome> {
      return new Promise((resolve) => {
        queue.push({ intent, resolve });
        // Defer to a microtask so a burst of synchronous requests (Ctrl+S
        // spam) is fully queued before the drain starts — otherwise the
        // first request would drain alone and every later one would queue
        // behind it, defeating coalescing.
        void Promise.resolve().then(() => {
          void pump();
        });
      });
    },
    isRunning: () => running || queue.length > 0,
  };
}
