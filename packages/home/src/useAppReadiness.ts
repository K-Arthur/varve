import { useEffect, useState } from 'react';

export type ReadinessStatus = 'initializing' | 'ready' | 'failed';

export interface AppReadiness {
  status: ReadinessStatus;
  error: string | null;
  retry: () => void;
}

/**
 * Manages application initialization state and timeout handling.
 * Transitions from initializing to ready when `isLoaded` becomes true.
 * Times out if not ready within `timeoutMs`.
 */
export function useAppReadiness(isLoaded: boolean, timeoutMs = 15000): AppReadiness {
  const [status, setStatus] = useState<ReadinessStatus>('initializing');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoaded) {
      setStatus('ready');
      setError(null);
    }
  }, [isLoaded]);

  useEffect(() => {
    if (status !== 'initializing') return;

    const timer = setTimeout(() => {
      setStatus('failed');
      setError('Application took too long to initialize. Please check your connection and try again.');
    }, timeoutMs);

    return () => clearTimeout(timer);
  }, [status, timeoutMs]);

  const retry = () => {
    setStatus('initializing');
    setError(null);
  };

  return { status, error, retry };
}
