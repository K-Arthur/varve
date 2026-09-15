import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { useEditor } from '../../context';
import { useFindReplace } from '../../findReplace/useFindReplace';
import { FindReplaceBar } from '../FindReplace/FindReplaceBar';

export interface FindReplaceLayerHandle {
  open: (initialSearch?: string) => void;
}

export const FindReplaceLayer = forwardRef<FindReplaceLayerHandle>(
  function FindReplaceLayer(_props, ref) {
    const editor = useEditor();
    const restoreFocusRef = useRef<HTMLElement | null>(null);
    const api = useFindReplace(
      () => editor.state.document,
      () => editor.state.selection,
      editor.updateDoc,
      editor.beginTransaction,
      editor.commitTransaction,
      editor.setSelection,
      editor.announce,
      editor.state.revision,
    );

    const close = useCallback(() => {
      api.close();
      const restoreTarget = restoreFocusRef.current;
      restoreFocusRef.current = null;
      requestAnimationFrame(() => restoreTarget?.focus());
    }, [api]);

    useImperativeHandle(
      ref,
      () => ({
        open: (initialSearch?: string) => {
          restoreFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          api.open(initialSearch);
        },
      }),
      [api],
    );

    return <FindReplaceBar api={api} onRequestClose={close} />;
  },
);
