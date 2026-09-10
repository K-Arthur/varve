import type React from 'react';

interface DeviceFrameProps {
  device: {
    type: string;
    name: string;
    width: number;
    height: number;
    showNotch?: boolean;
    showHomeIndicator?: boolean;
  };
  children: React.ReactNode;
  scale?: number;
  frameColor?: string;
}

export function DeviceFrame({ device, children, scale, frameColor }: DeviceFrameProps) {
  const typeClass = `device-frame--${device.type}`;
  const showNotch = device.type === 'phone' && device.showNotch !== false;
  const showHomeIndicator = device.type === 'phone' && device.showHomeIndicator !== false;

  return (
    <div
      className={`device-frame ${typeClass}`}
      style={{
        width: device.width,
        height: device.height,
        transform: scale ? `scale(${scale})` : undefined,
        borderColor: frameColor ?? undefined,
      }}
    >
      {device.type === 'phone' && showNotch && <div className="device-frame__notch" />}
      {device.type === 'phone' && showHomeIndicator && (
        <div className="device-frame__home-indicator" />
      )}
      {device.type === 'desktop' && <div className="device-frame__stand" />}
      {device.type === 'custom' && <div className="device-frame__label">{device.name}</div>}
      <div className="device-frame__content">{children}</div>
    </div>
  );
}
