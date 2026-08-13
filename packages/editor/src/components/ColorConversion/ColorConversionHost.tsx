/**
 * ColorConversionHost — mounts the Document Color Mode dialog and registers
 * the module-level open bridge. Placed once in the editor shell.
 */
import { useEffect, useState } from 'react';
import { setColorConversionHandler } from './colorConversionBridge';
import { ColorConversionDialog } from './ColorConversionDialog';

export function ColorConversionHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setColorConversionHandler(() => setOpen(true));
    return () => setColorConversionHandler(null);
  }, []);
  return <ColorConversionDialog open={open} onClose={() => setOpen(false)} />;
}
