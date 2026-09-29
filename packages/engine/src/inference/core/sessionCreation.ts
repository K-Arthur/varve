/** Bounded session creation without overlapping a timed-out provider attempt. */

export class SessionCreationTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'SessionCreationTimeoutError';
  }
}

/** The late session could not be confirmed released; its worker must be retired. */
export class SessionCleanupFailedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SessionCleanupFailedError';
  }
}

export interface ReleasableSession {
  release?: () => Promise<void> | void;
}

/**
 * Race creation against a deadline, but retain ownership until the create
 * operation and any late-session release have actually settled. The caller
 * can then safely try another provider. If cleanup cannot be confirmed, the
 * caller must retire this worker instead of falling through.
 */
export async function createSessionWithTimeout<T extends ReleasableSession>(
  create: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SessionCreationTimeoutError(label, timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([create, deadline]);
  } catch (error) {
    if (!(error instanceof SessionCreationTimeoutError)) throw error;

    let lateSession: T;
    try {
      // A rejected create has stopped without producing a session. A pending
      // create stays owned here until it resolves or the host terminates this
      // worker at the encompassing inference deadline.
      lateSession = await create;
    } catch {
      throw error;
    }

    if (!lateSession.release) {
      throw new SessionCleanupFailedError(
        `${label} completed after its deadline, but the late session has no release method.`,
      );
    }
    try {
      await lateSession.release();
    } catch (cleanupError) {
      throw new SessionCleanupFailedError(
        `${label} completed after its deadline and its session could not be released.`,
        { cause: cleanupError },
      );
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
