import { useEffect, useState } from 'react';

/**
 * Keeps the busy semantics immediate while postponing the visual indicator for
 * operations that commonly settle within a frame or two.
 */
export function useDelayedLoading(loading: boolean, delay = 150): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!loading) {
      setVisible(false);
      return;
    }

    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [loading, delay]);

  return loading && visible;
}
