import type { Platform } from '@varve/platform';
import { useEffect, useState } from 'react';
import { QuickConvertDialog } from '../QuickConvert/QuickConvertDialog';

const OPEN_EVENT = 'varve:open-quick-convert';

export function QuickConvertDialogHost({ platform }: { platform?: Platform }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openDialog = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, openDialog);
    return () => window.removeEventListener(OPEN_EVENT, openDialog);
  }, []);

  return <QuickConvertDialog open={open} onClose={() => setOpen(false)} platform={platform} />;
}
