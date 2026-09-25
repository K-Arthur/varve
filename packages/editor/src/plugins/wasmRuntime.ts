/** One short-lived worker per operation. No guest JavaScript enters the host. */

export type GuestRuntimeResult = { validated: true; output?: string };

export interface GuestJob {
  result: Promise<GuestRuntimeResult>;
  stop: () => void;
}

export function startGuestJob(
  wasm: Uint8Array,
  operation: 'validate' | 'run',
  input?: string,
  timeoutMs = 5000,
): GuestJob {
  const worker = new Worker(new URL('./guestWorker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  let rejectJob: (reason: Error) => void = () => {};
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    worker.terminate();
    rejectJob(new Error('Plugin operation stopped'));
  };

  const result = new Promise<GuestRuntimeResult>((resolve, reject) => {
    rejectJob = reject;
    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(`Plugin exceeded its ${timeoutMs} ms time limit`));
    }, timeoutMs);
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      worker.terminate();
      const reply = event.data;
      if (!reply || typeof reply !== 'object') {
        reject(new Error('Plugin worker returned an invalid response'));
        return;
      }
      const record = reply as Record<string, unknown>;
      if (record.ok !== true || record.validated !== true) {
        reject(new Error(typeof record.error === 'string' ? record.error : 'Plugin worker failed'));
        return;
      }
      if (record.output !== undefined && typeof record.output !== 'string') {
        reject(new Error('Plugin worker returned an invalid output'));
        return;
      }
      resolve({ validated: true, output: record.output as string | undefined });
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      worker.terminate();
      reject(new Error('Plugin worker crashed'));
    };
    const copy = new Uint8Array(wasm);
    try {
      worker.postMessage({ operation, wasm: copy.buffer, input }, [copy.buffer]);
    } catch (error) {
      settled = true;
      clearTimeout(timeoutId);
      worker.terminate();
      reject(error);
    }
  });
  return { result, stop };
}
