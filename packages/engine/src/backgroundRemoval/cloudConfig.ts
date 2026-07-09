import type { BackgroundRemovalOptions } from './types';

export interface CloudProviderSettings {
  apiUrl: string;
  apiKey: string;
  timeout: number;
  maxRetries: number;
  usePreview: boolean;
  maxDimension: number;
  enabled: boolean;
}

const STORAGE_KEY = 'strata-bg-cloud-config';

export const DEFAULT_CONFIG: CloudProviderSettings = {
  apiUrl: '',
  apiKey: '',
  timeout: 30000,
  maxRetries: 2,
  usePreview: true,
  maxDimension: 2048,
  enabled: false,
};

export function loadCloudConfig(): CloudProviderSettings | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveCloudConfig(config: CloudProviderSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function resetCloudConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getCloudUrlForModel(
  apiBaseUrl: string,
  _method: BackgroundRemovalOptions['method'],
): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

export interface CloudApiResponse {
  maskDataUrl: string;
  confidence: number;
  width: number;
  height: number;
}
