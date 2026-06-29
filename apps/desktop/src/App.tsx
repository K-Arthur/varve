import { Shell } from '@strata/editor';
import { TitleBar } from './chrome/TitleBar';

export function App() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100dvw',
        height: '100dvh',
        overflow: 'hidden',
      }}
    >
      <TitleBar />
      <Shell />
    </div>
  );
}
