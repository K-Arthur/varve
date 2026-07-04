/**
 * useTypeAhead — debounced character buffer for APG Tree View type-ahead.
 *
 * Typing characters in quick succession accumulates a buffer; after 500ms of
 * inactivity the buffer resets. Matching is case-insensitive prefix match
 * starting from the node after the currently focused index.
 *
 * Research basis: APG Tree View pattern — type-ahead recommended for trees
 * with more than 7 root nodes.
 */
import { useCallback, useEffect, useRef } from 'react';

export interface TypeAheadState {
  handleTypeAhead: (
    char: string,
    getName: (i: number) => string,
    currentIdx: number,
    total: number,
  ) => number | null;
}

const RESET_MS = 500;

export function useTypeAhead(): TypeAheadState {
  const bufRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const handleTypeAhead = useCallback(
    (
      char: string,
      getName: (i: number) => string,
      currentIdx: number,
      total: number,
    ): number | null => {
      if (total === 0) return null;

      bufRef.current = (bufRef.current + char).toLowerCase();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        bufRef.current = '';
        timerRef.current = null;
      }, RESET_MS);

      for (let i = 0; i < total; i++) {
        const checkIdx = (currentIdx + 1 + i) % total;
        const name = getName(checkIdx).toLowerCase();
        if (name.startsWith(bufRef.current)) {
          return checkIdx;
        }
      }

      return null;
    },
    [],
  );

  return { handleTypeAhead };
}
