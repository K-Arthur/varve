import { ToastProvider } from '@varve/ui';
import { HomeShell, type HomeShellProps } from './HomeShell';

/** Public Home entry point with the window-scoped notification provider. */
export function HomeShellRoot(props: HomeShellProps) {
  return (
    <ToastProvider>
      <HomeShell {...props} />
    </ToastProvider>
  );
}
