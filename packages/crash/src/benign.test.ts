import { describe, expect, it } from 'vitest';
import {
  diagnosticParts,
  isBenignDiagnostic,
  isBenignRejection,
  isBenignWindowErrorEvent,
} from './benign';

describe('isBenignDiagnostic', () => {
  it('treats both Chromium ResizeObserver loop messages as benign', () => {
    expect(
      isBenignDiagnostic('ResizeObserver loop completed with undelivered notifications.'),
    ).toBe(true);
    expect(isBenignDiagnostic('ResizeObserver loop limit exceeded')).toBe(true);
    expect(
      isBenignDiagnostic(new Error('ResizeObserver loop completed with undelivered notifications')),
    ).toBe(true);
  });

  it('treats AbortError, abort messages, and cancelled work as benign', () => {
    expect(isBenignDiagnostic(new DOMException('The operation was aborted.', 'AbortError'))).toBe(
      true,
    );
    expect(isBenignDiagnostic(new DOMException('The user aborted a request.', 'AbortError'))).toBe(
      true,
    );
    const named = new Error('Aborted');
    named.name = 'AbortError';
    expect(isBenignDiagnostic(named)).toBe(true);
    expect(isBenignDiagnostic(new Error('signal is aborted without reason'))).toBe(true);
    expect(isBenignDiagnostic(new Error('Export cancelled'))).toBe(true);
    expect(isBenignDiagnostic({ name: 'AbortError', message: 'cancelled' })).toBe(true);
  });

  it('treats recovered GPU context/device loss as benign', () => {
    expect(isBenignDiagnostic(new Error('WebGL context lost'))).toBe(true);
    expect(isBenignDiagnostic(new Error('WebGL2 context lost'))).toBe(true);
    expect(isBenignDiagnostic(new Error('WebGPU device was lost'))).toBe(true);
    const lost = new Error('Device was lost.');
    lost.name = 'GPUDeviceLostError';
    expect(isBenignDiagnostic(lost)).toBe(true);
  });

  it('treats window-close Tauri IPC rejections as benign', () => {
    expect(isBenignDiagnostic(new Error('webview dropped'))).toBe(true);
    expect(isBenignDiagnostic(new Error('The webview was destroyed'))).toBe(true);
    expect(isBenignDiagnostic(new Error('window not found'))).toBe(true);
    expect(isBenignDiagnostic(new Error('command was cancelled'))).toBe(true);
  });

  it('treats font-face load failures as benign', () => {
    const network = new Error('A network error occurred loading font');
    network.name = 'NetworkError';
    expect(isBenignDiagnostic(network)).toBe(true);
    expect(isBenignDiagnostic(new Error('Failed to load font "Geist Variable"'))).toBe(true);
  });

  it('does not swallow genuine crashes', () => {
    expect(isBenignDiagnostic(new Error('Cannot read properties of null (reading "engine")'))).toBe(
      false,
    );
    expect(isBenignDiagnostic(new Error('RuntimeError: unreachable'))).toBe(false);
    expect(isBenignDiagnostic(new TypeError('Failed to fetch'))).toBe(false);
    expect(isBenignDiagnostic(new Error('canvas render failed'))).toBe(false);
    expect(isBenignDiagnostic('')).toBe(false);
    expect(isBenignDiagnostic(null)).toBe(false);
  });

  it('classifies window error and rejection wrappers', () => {
    expect(
      isBenignWindowErrorEvent(
        new ErrorEvent('error', { message: 'ResizeObserver loop limit exceeded.' }),
      ),
    ).toBe(true);
    expect(isBenignWindowErrorEvent(new Event('webglcontextlost'))).toBe(true);
    expect(
      isBenignWindowErrorEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') })),
    ).toBe(false);
    expect(isBenignRejection(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isBenignRejection(new Error('synthetic unhandled rejection'))).toBe(false);
  });

  it('reads name/message from non-Error invoke payloads', () => {
    expect(diagnosticParts({ name: 'AbortError', message: 'cancelled' })).toEqual({
      name: 'AbortError',
      message: 'cancelled',
    });
  });
});
