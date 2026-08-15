/**
 * ColorConversionHost — mounts the Document Color Mode dialog and registers
 * the module-level open bridge. Placed once in the editor shell.
 */
import { useEffect, useState } from 'react';
import { ColorConversionDialog } from './ColorConversionDialog';
import { setColorConversionHandler } from './colorConversionBridge';

export function ColorConversionHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setColorConversionHandler(() => setOpen(true));
    return () => setColorConversionHandler(null);
  }, []);
  return <ColorConversionDialog open={open} onClose={() => setOpen(false)} />;
}
