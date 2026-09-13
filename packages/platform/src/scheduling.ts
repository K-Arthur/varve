/** Yield a long-running derived task back to the browser when possible. */
export async function yieldToMain(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Task cancelled', 'AbortError');

  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> };
    }
  ).scheduler;
  if (typeof scheduler?.yield === 'function') {
    await scheduler.yield();
  } else if (typeof MessageChannel !== 'undefined') {
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
  } else {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  if (signal?.aborted) throw new DOMException('Task cancelled', 'AbortError');
}
