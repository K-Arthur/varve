import React from 'react';

export interface SoftProofOverlayProps {
  softProofEnabled: boolean;
}

export function SoftProofOverlay({ softProofEnabled }: SoftProofOverlayProps) {
  if (!softProofEnabled) return null;

  return (
    <div
      data-testid="soft-proof-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        zIndex: 9998,
        mixBlendMode: 'saturation' as React.CSSProperties['mixBlendMode'],
        background: 'transparent',
      }}
    />
  );
}
