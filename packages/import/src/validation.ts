import type { ColorConfig, ManagedColor } from '@varve/scene';
import { isCmykColor, isRgbColor, isSpotColor } from '@varve/scene';
import { getParserForData, getParserForExtension } from './registry';

/** Colors that carry channel data (not spot references) can have bitDepth/profile. */
function hasChannelMeta(
  color: ManagedColor,
): color is Extract<ManagedColor, { bitDepth?: unknown; profile?: unknown }> {
  return !isSpotColor(color);
}

export interface ImportColorWarning {
  message: string;
  severity: 'info' | 'warning';
}

export interface ImportColorValidation {
  warnings: ImportColorWarning[];
}

/**
 * Check whether an imported color's profile/space/bitDepth is compatible
 * with the target document's color model. Returns actionable warnings when
 * the import will lose precision, convert color spaces, or mismatch profiles.
 */
export function validateImportColor(
  color: ManagedColor,
  docConfig: ColorConfig,
): ImportColorValidation {
  const warnings: ImportColorWarning[] = [];

  // Bit depth precision check (channel colors only — spot refs carry no channels)
  if (hasChannelMeta(color) && color.bitDepth && color.bitDepth !== docConfig.bitDepth) {
    const precisionOrder: Record<string, number> = {
      uint8: 0,
      uint16: 1,
      float16: 2,
      float32: 3,
    };
    const imported = precisionOrder[color.bitDepth] ?? 0;
    const doc = precisionOrder[docConfig.bitDepth] ?? 0;
    if (imported > doc) {
      warnings.push({
        message: `Document is ${docConfig.bitDepth} but imported color uses ${color.bitDepth} precision — values will be truncated`,
        severity: 'warning',
      });
    }
  }

  // Color space mismatch
  if (isCmykColor(color) && docConfig.mode !== 'cmyk') {
    const intent = docConfig.outputIntent?.renderingIntent;
    const intentSuffix = intent ? ` (rendering intent: ${intent})` : '';
    warnings.push({
      message: `CMYK color imported into ${docConfig.mode.toUpperCase()} document — will convert to ${docConfig.mode.toUpperCase()}${intentSuffix}`,
      severity: 'warning',
    });
  } else if (isRgbColor(color) && docConfig.mode === 'cmyk') {
    const intent = docConfig.outputIntent?.renderingIntent;
    const intentSuffix = intent ? ` (rendering intent: ${intent})` : '';
    warnings.push({
      message: `RGB color imported into CMYK document — will convert to CMYK${intentSuffix}`,
      severity: 'warning',
    });
  }

  // Profile mismatch (channel colors only)
  if (hasChannelMeta(color) && color.profile) {
    const docProfile =
      docConfig.mode === 'cmyk' ? docConfig.cmykProfile.id : docConfig.rgbProfile.id;
    if (color.profile !== docProfile) {
      warnings.push({
        message: `Imported color uses ICC profile "${color.profile}" but document uses "${docProfile}" — appearance may shift`,
        severity: 'info',
      });
    }
  }

  return { warnings };
}

export interface ImportValidation {
  valid: boolean;
  format: string;
  estimatedNodeCount: number;
  unsupportedFeatures: string[];
  warnings: string[];
  pageCount: number;
  sizeBytes: number;
}

export async function validateImport(
  data: string | Uint8Array,
  filename: string,
): Promise<ImportValidation> {
  const ext = filename.split('.').pop() ?? '';
  const parser = getParserForExtension(ext) ?? getParserForData(data);
  const sizeBytes = typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
  const unsupportedFeatures: string[] = [];
  const warnings: string[] = [];

  if (!parser) {
    return {
      valid: false,
      format: ext || 'unknown',
      estimatedNodeCount: 0,
      unsupportedFeatures,
      warnings: [`No parser found for format: ${ext || 'unknown'}`],
      pageCount: 0,
      sizeBytes,
    };
  }

  // Quick analysis
  let estimatedNodeCount = 0;
  let pageCount = 1;

  if (parser.format === 'svg') {
    const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
    const tagCount = (str.match(/<(\w+)[\s>/]/g) || []).length;
    estimatedNodeCount = Math.max(1, Math.floor(tagCount * 0.6));
    if (str.includes('linearGradient') || str.includes('radialGradient')) {
      unsupportedFeatures.push('SVG gradients may not render identically');
    }
    if (str.includes('<pattern')) {
      unsupportedFeatures.push('SVG patterns');
    }
    if (str.includes('filter=') || str.includes('<filter')) {
      unsupportedFeatures.push('SVG filters');
    }
    if (str.includes('<clipPath')) {
      unsupportedFeatures.push('SVG clip paths');
    }
  } else if (parser.format === 'pdf') {
    pageCount = estimatePdfPageCount(data);
    if (pageCount > 1) {
      estimatedNodeCount = pageCount * 3;
    } else {
      estimatedNodeCount = Math.max(1, estimateContentNodes(data));
    }
    unsupportedFeatures.push(
      'PDF transparency blending',
      'PDF gradient fills (will be approximated)',
      'PDF embedded fonts (will use substitutes)',
    );
  } else if (parser.format === 'psd') {
    const layers = estimatePsdLayerCount(data);
    estimatedNodeCount = Math.max(1, layers);
    unsupportedFeatures.push(
      'PSD layer effects (drop shadow, glow, etc.)',
      'PSD adjustment layers',
      'PSD smart objects',
      'PSD layer masks and clipping masks',
    );
  } else if (parser.format === 'ai') {
    estimatedNodeCount = estimateAiNodeCount(data);
    unsupportedFeatures.push(
      'AI gradient meshes',
      'AI transparency flattener',
      'AI native effects (will be rasterized)',
    );
  } else if (parser.format === 'eps') {
    estimatedNodeCount = estimateEpsNodeCount(data);
    unsupportedFeatures.push(
      'EPS PostScript features beyond basic paths',
      'EPS embedded fonts',
      'EPS patterns and gradients',
    );
    if (data instanceof Uint8Array || typeof data === 'string') {
      const content = typeof data === 'string' ? data : new TextDecoder().decode(data);
      if (content.match(/clippath/i)) {
        unsupportedFeatures.push('EPS clipping paths');
      }
    }
  } else if (parser.format === 'sketch') {
    estimatedNodeCount = estimateSketchLayerCount(data);
    unsupportedFeatures.push(
      'Sketch symbols and overrides',
      'Sketch shared styles',
      'Sketch constraints and resizing rules',
      'Sketch advanced effects and blend modes',
    );
  } else if (parser.format === 'figma') {
    estimatedNodeCount = estimateFigmaNodeCount(data);
    if (!parser.canParse(data))
      warnings.push('Figma input is not official file JSON or a supported plugin export');
    unsupportedFeatures.push(
      'opaque native .fig binary',
      'Figma boolean operations',
      'Figma scroll behavior',
      'Figma layout grids',
    );
  }

  // Check for empty or too-small data
  if (sizeBytes < 4) {
    warnings.push('File is empty or too small to contain valid content');
  }

  if (parser.canParse(data)) {
    if (warnings.length === 0 && sizeBytes >= 4) {
      // Try a quick parse for a more accurate node count
      try {
        const result = parser.parse(data);
        // Use the larger of estimate and parse result
        const parsedCount = result.nodeIds.length;
        if (parsedCount > estimatedNodeCount) {
          estimatedNodeCount = parsedCount;
        }
        warnings.push(...result.warnings);
      } catch {
        warnings.push('File structure appears valid but parsing encountered issues');
      }
    }
    return {
      valid: sizeBytes >= 4,
      format: parser.format,
      estimatedNodeCount,
      unsupportedFeatures,
      warnings: deduplicateWarnings([...warnings, ...unsupportedFeatures]),
      pageCount,
      sizeBytes,
    };
  }

  return {
    valid: false,
    format: parser.format,
    estimatedNodeCount,
    unsupportedFeatures,
    warnings: [...warnings, 'Parser detected format but cannot parse this specific file'],
    pageCount,
    sizeBytes,
  };
}

function estimatePdfPageCount(data: string | Uint8Array): number {
  const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
  const pageMatches = str.match(/\/Type\s*\/Page[^s]/g);
  return Math.max(1, pageMatches?.length ?? 1);
}

function estimateContentNodes(data: string | Uint8Array): number {
  const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
  let count = 0;
  count += (str.match(/Tf\b/g) || []).length;
  count += (str.match(/re\b/g) || []).length;
  count += (str.match(/cm\b/g) || []).length;
  return Math.max(1, count);
}

function estimatePsdLayerCount(_data: string | Uint8Array): number {
  return 5;
}

function estimateAiNodeCount(data: string | Uint8Array): number {
  const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
  const cmdCount = (str.match(/[a-zA-Z]\s+-?[\d.]+/g) || []).length;
  return Math.max(1, Math.floor(cmdCount * 0.3));
}

function estimateEpsNodeCount(data: string | Uint8Array): number {
  const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
  const cmdCount = (str.match(/(rectfill|rectstroke|lineto|moveto|curveto|show)\b/gi) || []).length;
  return Math.max(1, cmdCount);
}

function estimateSketchLayerCount(data: string | Uint8Array): number {
  if (typeof data === 'string') return 0;
  const text = new TextDecoder().decode(data);
  const layerMatches = text.match(/"_class"\s*:/g) ?? [];
  return Math.max(1, layerMatches.length);
}

function estimateFigmaNodeCount(data: string | Uint8Array): number {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
  return Math.max(
    1,
    (text.match(/"type"\s*:\s*"(?:FRAME|TEXT|VECTOR|RECTANGLE|INSTANCE|COMPONENT)"/g) ?? []).length,
  );
}

function deduplicateWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}
