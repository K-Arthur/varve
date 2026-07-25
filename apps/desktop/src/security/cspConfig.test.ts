/**
 * @vitest-environment node
 *
 * Validates the Tauri CSP configuration in tauri.conf.json.
 * These tests ensure the CSP meets security requirements:
 * - Production CSP is non-null
 * - Dev-only hosts (localhost) are absent from production
 * - Required directives are present and least-privilege
 * - Tauri IPC schemes are allowed
 * - Unsafe-eval is NOT present
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface CspConfig {
  'default-src'?: string[];
  'script-src'?: string[];
  'style-src'?: string[];
  'img-src'?: string[];
  'font-src'?: string[];
  'connect-src'?: string[];
  'worker-src'?: string[];
  'media-src'?: string[];
  'object-src'?: string[];
  'frame-src'?: string[];
  'base-uri'?: string[];
  'form-action'?: string[];
  'manifest-src'?: string[];
}

interface SecurityConfig {
  csp: CspConfig | null;
  devCsp: CspConfig | null;
  capabilities: string[];
}

function loadSecurityConfig(): SecurityConfig {
  const configPath = join(__dirname, '../../src-tauri/tauri.conf.json');
  const raw = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw);
  return config.app.security;
}

describe('Tauri CSP configuration', () => {
  const security = loadSecurityConfig();
  const prod = security.csp;
  const dev = security.devCsp;

  describe('production CSP', () => {
    it('is non-null', () => {
      expect(prod).not.toBeNull();
    });

    it('has default-src set to self only', () => {
      expect(prod!['default-src']).toEqual(["'self'"]);
    });

    it('allows wasm-unsafe-eval for WASM execution', () => {
      expect(prod!['script-src']).toContain("'wasm-unsafe-eval'");
    });

    it('allows blob: for WASM glue loading', () => {
      expect(prod!['script-src']).toContain('blob:');
    });

    it('does NOT allow unsafe-eval', () => {
      expect(prod!['script-src']).not.toContain("'unsafe-eval'");
    });

    it('allows data: and blob: for images (canvas previews, thumbnails)', () => {
      expect(prod!['img-src']).toContain('data:');
      expect(prod!['img-src']).toContain('blob:');
    });

    it('allows HTTPS images (user-provided remote images)', () => {
      expect(prod!['img-src']).toContain('https:');
    });

    it('allows Tauri IPC schemes in connect-src', () => {
      expect(prod!['connect-src']).toContain('ipc:');
      expect(prod!['connect-src']).toContain('http://ipc.localhost');
    });

    it('allows model download origins', () => {
      const connect = prod!['connect-src'];
      expect(connect).toContain('https://github.com');
      expect(connect).toContain('https://huggingface.co');
      expect(connect).toContain('https://raw.githubusercontent.com');
    });

    it('restricts worker-src to self', () => {
      expect(prod!['worker-src']).toEqual(["'self'"]);
    });

    it('sets object-src to none', () => {
      expect(prod!['object-src']).toEqual(["'none'"]);
    });

    it('sets frame-src to none', () => {
      expect(prod!['frame-src']).toEqual(["'none'"]);
    });

    it('sets base-uri to self', () => {
      expect(prod!['base-uri']).toEqual(["'self'"]);
    });

    it('sets form-action to none', () => {
      expect(prod!['form-action']).toEqual(["'none'"]);
    });

    it('does NOT contain localhost or dev server hosts', () => {
      const allValues = Object.values(prod!).flat();
      expect(allValues).not.toContain('http://localhost:1420');
      expect(allValues).not.toContain('ws://localhost:1420');
    });

    it('does NOT contain wildcard *', () => {
      const allValues = Object.values(prod!).flat();
      expect(allValues).not.toContain('*');
    });
  });

  describe('development CSP', () => {
    it('is non-null', () => {
      expect(dev).not.toBeNull();
    });

    it('allows Vite HMR WebSocket', () => {
      expect(dev!['connect-src']).toContain('ws://localhost:1420');
    });

    it('allows dev server origin', () => {
      expect(dev!['connect-src']).toContain("'self'");
    });

    it('does NOT allow unsafe-eval', () => {
      expect(dev!['script-src']).not.toContain("'unsafe-eval'");
    });

    it('allows wasm-unsafe-eval for WASM in dev', () => {
      expect(dev!['script-src']).toContain("'wasm-unsafe-eval'");
    });
  });

  describe('CSP differences', () => {
    it('dev has localhost WebSocket that prod lacks', () => {
      expect(dev!['connect-src']).toContain('ws://localhost:1420');
      expect(prod!['connect-src']).not.toContain('ws://localhost:1420');
    });

    it('prod and dev share the same script-src policy', () => {
      expect(prod!['script-src']).toEqual(dev!['script-src']);
    });
  });
});
