import type { ManifestEntry, TensorContract } from './types';

export type ManifestValidationSeverity = 'error' | 'warning' | 'info';

export interface ManifestValidationIssue {
  modelId: string;
  field: string;
  severity: ManifestValidationSeverity;
  message: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  issues: ManifestValidationIssue[];
  errors: ManifestValidationIssue[];
  warnings: ManifestValidationIssue[];
}

export type ModelAvailabilityStatus =
  | 'available'
  | 'installed'
  | 'experimental'
  | 'metadata-incomplete'
  | 'source-unavailable'
  | 'security-verification-missing'
  | 'platform-incompatible'
  | 'temporarily-disabled'
  | 'checksum-missing'
  | 'no-url'
  | 'placeholder-url'
  | 'missing-license'
  | 'missing-tensor-contract'
  | 'high-memory-only';

const PLACEHOLDER_URLS = ['', 'http://', 'https://', 'TBD', 'tbd', 'placeholder'];

function isPlaceholderUrl(url: string): boolean {
  return PLACEHOLDER_URLS.includes(url) || url.trim() === '';
}

function isHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function _hasCompleteTensorContract(tc?: TensorContract): boolean {
  if (!tc) return false;
  if (!tc.inputs || tc.inputs.length === 0) return false;
  if (!tc.outputs || tc.outputs.length === 0) return false;
  return true;
}

export function validateManifestEntry(entry: ManifestEntry): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];

  if (!entry.id) {
    issues.push({
      modelId: entry.id || '(missing)',
      field: 'id',
      severity: 'error',
      message: 'Model has no ID.',
    });
    return issues;
  }

  if (!entry.remoteUrl && !entry.bundled && (!entry.components || entry.components.length === 0)) {
    issues.push({
      modelId: entry.id,
      field: 'remoteUrl',
      severity: 'error',
      message: 'No remote URL and not bundled.',
    });
  }

  if (entry.remoteUrl && isPlaceholderUrl(entry.remoteUrl)) {
    issues.push({
      modelId: entry.id,
      field: 'remoteUrl',
      severity: 'error',
      message: 'Download URL is empty or a placeholder.',
    });
  }

  if (entry.remoteUrl && !isPlaceholderUrl(entry.remoteUrl) && !isHttpsUrl(entry.remoteUrl)) {
    issues.push({
      modelId: entry.id,
      field: 'remoteUrl',
      severity: 'warning',
      message: 'Download URL is not HTTPS.',
    });
  }

  if (!entry.sha256 && !entry.bundled) {
    issues.push({
      modelId: entry.id,
      field: 'sha256',
      severity: 'error',
      message: 'No SHA-256 checksum. Cannot securely verify model integrity.',
    });
  }

  if (entry.sha256 === null || entry.sha256 === undefined) {
    if (!entry.bundled) {
      issues.push({
        modelId: entry.id,
        field: 'sha256',
        severity: 'error',
        message: 'SHA-256 is null/undefined. Model cannot be verified.',
      });
    }
  }

  if (entry.bundled && !entry.localPath) {
    issues.push({
      modelId: entry.id,
      field: 'localPath',
      severity: 'warning',
      message: 'Bundled model but localPath is missing.',
    });
  }

  if (
    entry.sourceLicense === undefined ||
    entry.sourceLicense === null ||
    entry.sourceLicense === ''
  ) {
    issues.push({
      modelId: entry.id,
      field: 'sourceLicense',
      severity: 'warning',
      message: 'Missing license information.',
    });
  }

  if (entry.components && entry.components.length > 0) {
    const filenames = entry.components.map((c) => c.filename);
    const uniqueFilenames = new Set(filenames);
    if (filenames.length !== uniqueFilenames.size) {
      issues.push({
        modelId: entry.id,
        field: 'components',
        severity: 'error',
        message: 'Duplicate filenames in component list.',
      });
    }

    for (const comp of entry.components) {
      if (!comp.id) {
        issues.push({
          modelId: entry.id,
          field: 'components',
          severity: 'error',
          message: `Component missing id.`,
        });
      }
      if (!comp.filename) {
        issues.push({
          modelId: entry.id,
          field: 'components',
          severity: 'error',
          message: `Component ${comp.id} missing filename.`,
        });
      }
    }

    const hasComponentsWithUrl = entry.components.some(
      (c) => c.remoteUrl && !isPlaceholderUrl(c.remoteUrl),
    );
    if (!hasComponentsWithUrl) {
      issues.push({
        modelId: entry.id,
        field: 'components',
        severity: 'error',
        message: 'Components declared but no component has a valid download URL.',
      });
    }
  }

  const parentEntryHasContract = entry.tensorContract !== undefined;
  const componentContracts = entry.components?.filter((c) => 'tensorContract' in c) ?? [];
  if (!parentEntryHasContract && componentContracts.length === 0 && !entry.bundled) {
    issues.push({
      modelId: entry.id,
      field: 'tensorContract',
      severity: 'warning',
      message: 'Missing tensor contract. Runtime compatibility cannot be verified.',
    });
  }

  if (!entry.modelVersion) {
    issues.push({
      modelId: entry.id,
      field: 'modelVersion',
      severity: 'warning',
      message: 'Missing model version.',
    });
  }

  return issues;
}

export function validateManifest(models: ManifestEntry[]): ManifestValidationResult {
  const issues: ManifestValidationIssue[] = [];
  const seenIds = new Set<string>();
  const seenFiles = new Set<string>();

  for (const entry of models) {
    if (seenIds.has(entry.id)) {
      issues.push({
        modelId: entry.id,
        field: 'id',
        severity: 'error',
        message: `Duplicate model ID: ${entry.id}`,
      });
    }
    seenIds.add(entry.id);

    if (entry.filename && seenFiles.has(entry.filename)) {
      issues.push({
        modelId: entry.id,
        field: 'filename',
        severity: 'warning',
        message: `Duplicate filename: ${entry.filename}`,
      });
    }
    if (entry.filename) {
      seenFiles.add(entry.filename);
    }

    issues.push(...validateManifestEntry(entry));
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
  };
}

export function determineModelAvailability(entry: ManifestEntry): ModelAvailabilityStatus {
  if (entry.bundled) return 'installed';
  if (!entry.remoteUrl || isPlaceholderUrl(entry.remoteUrl)) {
    return 'source-unavailable';
  }
  if (!entry.sha256) {
    return 'security-verification-missing';
  }
  return 'available';
}

export function invalidManifestStates(): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];

  issues.push({
    modelId: '(policy)',
    field: 'policy',
    severity: 'error',
    message: 'No URL and no checksum: model cannot be securely downloaded.',
  });
  issues.push({
    modelId: '(policy)',
    field: 'policy',
    severity: 'error',
    message: 'Placeholder URL: model appears to be a stub without a real download source.',
  });
  issues.push({
    modelId: '(policy)',
    field: 'policy',
    severity: 'error',
    message: 'Empty component list for multi-component model: no downloadable parts.',
  });
  issues.push({
    modelId: '(policy)',
    field: 'policy',
    severity: 'error',
    message: 'Duplicate file names: will cause storage conflicts.',
  });
  issues.push({
    modelId: '(policy)',
    field: 'policy',
    severity: 'error',
    message: 'Duplicate model IDs: leads to undefined behavior in the registry.',
  });
  issues.push({
    modelId: '(policy)',
    field: 'policy',
    severity: 'error',
    message: 'Conflicting versions: same ID declared with different versions.',
  });
  issues.push({
    modelId: '(policy)',
    field: 'policy',
    severity: 'error',
    message: 'Unsupported protocol: only HTTPS download URLs are accepted.',
  });
  issues.push({
    modelId: '(policy)',
    field: 'policy',
    severity: 'error',
    message: 'Missing license: required for redistribution tracking.',
  });
  issues.push({
    modelId: '(policy)',
    field: 'policy',
    severity: 'error',
    message: 'Missing tensor contracts: runtime compatibility cannot be determined.',
  });
  issues.push({
    modelId: '(policy)',
    field: 'policy',
    severity: 'error',
    message: 'Model size inconsistent with component totals: possible data entry error.',
  });

  return issues;
}
