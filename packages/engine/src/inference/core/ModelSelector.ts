import type {
  ExecutionProvider,
  ModelInstallInfo,
  ModelManifestEntry,
  ModelPrecision,
  QualityTier,
  RuntimeCapabilities,
  SelectionContext,
  SelectionDecision,
  TaskCategory,
} from './types';

export interface ModelSelectorOptions {
  manifestEntries: Map<string, ModelManifestEntry>;
  installStates: Map<string, ModelInstallInfo>;
  runtimeCapabilities: RuntimeCapabilities;
}

export class ModelSelector {
  private readonly manifest: Map<string, ModelManifestEntry>;
  private readonly installStates: Map<string, ModelInstallInfo>;
  private readonly caps: RuntimeCapabilities;

  constructor(options: ModelSelectorOptions) {
    this.manifest = options.manifestEntries;
    this.installStates = options.installStates;
    this.caps = options.runtimeCapabilities;
  }

  select(ctx: SelectionContext): SelectionDecision {
    if (ctx.qualityMode === 'custom') {
      return this.selectCustom(ctx);
    }

    const candidates = this.getCandidates(ctx.task);
    if (candidates.length === 0) {
      return this.noModelDecision(ctx.task);
    }

    return this.selectFromCandidates(candidates, ctx);
  }

  private getCandidates(task: TaskCategory): ModelManifestEntry[] {
    const result: ModelManifestEntry[] = [];
    for (const entry of this.manifest.values()) {
      if (entry.category === task || this.taskAlias(entry.category) === task) {
        result.push(entry);
      }
    }
    result.sort((a, b) => b.quality - a.quality);
    return result;
  }

  private taskAlias(category: TaskCategory): TaskCategory | null {
    if (category === 'background-removal') return 'segmentation';
    return null;
  }

  private selectFromCandidates(
    candidates: ModelManifestEntry[],
    ctx: SelectionContext,
  ): SelectionDecision {
    const rejections: SelectionDecision['rejections'] = [];

    for (const candidate of candidates) {
      const variant = this.selectPrecision(candidate, ctx);
      if (!variant) {
        rejections.push({
          modelId: candidate.id,
          precision: candidate.precision,
          reason: 'No suitable precision variant found',
        });
        continue;
      }

      const provider = this.selectProvider(variant, ctx);
      if (!provider) {
        rejections.push({
          modelId: variant.id,
          precision: variant.precision,
          reason: 'No compatible execution provider',
        });
        continue;
      }

      const installState = this.installStates.get(variant.id);
      const isAvailable = installState?.state === 'ready' || variant.bundled;

      const memoryTier = this.caps.memoryTier ?? 'high';

      if (memoryTier === 'low' && variant.peakMemoryBytes && !isAvailable) {
        const lighterEntry = this.findLighterEntry(candidates, variant);
        if (lighterEntry) {
          rejections.push({
            modelId: variant.id,
            precision: variant.precision,
            reason: `Skipping large model on low-memory system, preferring ${lighterEntry.id}`,
          });
          continue;
        }
      }

      const memorySafe = this.isMemorySafe(variant, ctx.inputWidth, ctx.inputHeight);

      if (!isAvailable && !memorySafe.safe) {
        rejections.push({
          modelId: variant.id,
          precision: variant.precision,
          reason: memorySafe.reason || 'Not available and exceeds memory budget',
        });
        continue;
      }

      const requireDownload = !variant.bundled && installState?.state !== 'ready';
      const tiling = this.needsTiling(variant, ctx.inputWidth, ctx.inputHeight);
      const downscale = this.needsDownscale(variant, ctx.inputWidth, ctx.inputHeight);
      const approximate = tiling || downscale;
      const warnings: string[] = [];
      if (memorySafe.warning) warnings.push(memorySafe.warning);

      return {
        modelId: variant.id,
        precision: variant.precision,
        executionProvider: provider,
        quality: variant.quality,
        speed: variant.speed ?? this.estimateSpeed(variant),
        estimatedRuntimeMs: this.estimateRuntime(variant, ctx),
        estimatedPeakMemoryBytes: this.estimateMemory(variant, ctx),
        requireDownload,
        tiling,
        downscale,
        approximate,
        warnings: warnings.length > 0 ? warnings : undefined,
        reason: this.buildSelectionReason(variant, ctx, provider, tiling, downscale),
        rejections,
      };
    }

    return this.fallbackDecision(ctx.task, rejections);
  }

  private selectPrecision(
    entry: ModelManifestEntry,
    ctx: SelectionContext,
  ): ModelManifestEntry | null {
    const qualityMode = ctx.qualityMode;

    if (qualityMode === 'high-quality' || qualityMode === 'balanced') {
      const fp32Entry = this.findVariant(entry.id, 'fp32');
      if (fp32Entry) return fp32Entry;
      return entry;
    }

    if (qualityMode === 'fast') {
      const int8Entry = this.findVariant(entry.id, 'int8');
      if (int8Entry) return int8Entry;
      if (this.isInt8Beneficial(ctx.runtimeCapabilities, entry.id)) {
        const int8Alt = this.findInt8Variant(entry.sourceModelId ?? entry.id);
        if (int8Alt) return int8Alt;
      }
      return entry;
    }

    if (qualityMode === 'auto') {
      if (entry.bundled) {
        const int8Entry = this.findVariant(entry.id, 'int8');
        if (int8Entry && this.isInt8Beneficial(ctx.runtimeCapabilities, entry.id)) {
          if (this.isQualityAdequate(int8Entry, entry)) {
            return int8Entry;
          }
        }
      }
      return entry;
    }

    return entry;
  }

  private findVariant(modelId: string, precision: ModelPrecision): ModelManifestEntry | null {
    for (const entry of this.manifest.values()) {
      if (entry.sourceModelId === modelId && entry.precision === precision) return entry;
      if (entry.id === `${modelId}-${precision}`) return entry;
    }
    return null;
  }

  private findInt8Variant(modelId: string): ModelManifestEntry | null {
    for (const entry of this.manifest.values()) {
      if (entry.sourceModelId === modelId && entry.precision === 'int8') return entry;
      if (entry.id === `${modelId}-int8`) return entry;
    }
    return null;
  }

  private isInt8Beneficial(caps: RuntimeCapabilities, _modelId: string): boolean {
    if (caps.hasVnni) return true;
    if (caps.hasAvx512) return true;
    if (caps.hasDotProduct) return true;
    return false;
  }

  private isQualityAdequate(
    int8Entry: ModelManifestEntry,
    _fp32Entry: ModelManifestEntry,
  ): boolean {
    if (int8Entry.qualityValidation) {
      return int8Entry.qualityValidation.passed;
    }
    return false;
  }

  private selectProvider(
    _entry: ModelManifestEntry,
    ctx: SelectionContext,
  ): ExecutionProvider | null {
    const preferred = ctx.runtimeCapabilities.preferredOnnxProviders;
    for (const p of preferred) {
      return p;
    }
    if (this.caps.isTauri) return 'native';
    return 'wasm';
  }

  private isMemorySafe(
    entry: ModelManifestEntry,
    _inputWidth: number,
    _inputHeight: number,
  ): { safe: boolean; reason?: string; warning?: string } {
    if (entry.bundled) return { safe: true };

    const peakMB = entry.peakMemoryBytes
      ? Math.round(entry.peakMemoryBytes / 1_000_000)
      : Math.round((entry.sizeBytes * 4) / 1_000_000);
    const sysMemoryMB = this.caps.approximateMemoryMB ?? 4096;
    const memoryTier =
      this.caps.memoryTier ?? (sysMemoryMB < 4096 ? 'low' : sysMemoryMB < 8192 ? 'medium' : 'high');

    if (entry.peakMemoryBytes) {
      // Peak against the peak budget, not the model-file budget.
      if (entry.peakMemoryBytes > this.caps.wasmSafePeakBytes && !this.caps.isTauri) {
        return {
          safe: false,
          reason: `Estimated peak memory ${peakMB}MB exceeds safe WASM budget ${Math.round(this.caps.wasmSafePeakBytes / 1_000_000)}MB`,
        };
      }
    }

    if (memoryTier === 'low') {
      if (peakMB > 1000) {
        return {
          safe: false,
          reason: `Model requires ~${peakMB}MB peak memory, not recommended on ${Math.round(sysMemoryMB / 1024)}GB systems (4GB minimum recommended)`,
        };
      }
      if (peakMB > 500) {
        return {
          safe: true,
          warning: `Model requires ~${peakMB}MB peak memory. Consider a lighter model on ${Math.round(sysMemoryMB / 1024)}GB systems.`,
        };
      }
    }

    if (memoryTier === 'medium' && peakMB > 2000) {
      return {
        safe: true,
        warning: `Large model (~${peakMB}MB peak) may impact system responsiveness on ${Math.round(sysMemoryMB / 1024)}GB systems.`,
      };
    }

    return { safe: true };
  }

  private needsTiling(entry: ModelManifestEntry, inputWidth: number, inputHeight: number): boolean {
    const maxDim = Math.max(inputWidth, inputHeight);
    const modelDim = this.getModelInputSize(entry);
    if (modelDim === null) return false;
    return maxDim > modelDim * 2;
  }

  private needsDownscale(
    entry: ModelManifestEntry,
    inputWidth: number,
    inputHeight: number,
  ): boolean {
    const maxDim = Math.max(inputWidth, inputHeight);
    const modelDim = this.getModelInputSize(entry);
    if (modelDim === null) return false;
    return maxDim > modelDim;
  }

  private getModelInputSize(entry: ModelManifestEntry): number | null {
    if (entry.tensorContract?.inputs[0]) {
      const dims = entry.tensorContract.inputs[0].dims;
      if (dims.length >= 3) {
        const h = dims[dims.length - 2] ?? null;
        const w = dims[dims.length - 1] ?? null;
        if (h !== null && w !== null) return Math.max(h, w);
      }
    }
    if (entry.inputSpec) return entry.inputSpec.inputSize;
    return null;
  }

  private estimateSpeed(entry: ModelManifestEntry): number {
    if (entry.precision === 'int8') return Math.min(entry.quality + 1, 5) as QualityTier;
    return Math.max(entry.quality - 1, 1) as QualityTier;
  }

  private estimateRuntime(entry: ModelManifestEntry, _ctx: SelectionContext): number {
    const sizeMB = entry.sizeBytes / 1_000_000;
    if (entry.quality >= 5) return Math.round(30_000 * Math.min(sizeMB / 200, 3));
    if (entry.quality >= 4) return Math.round(10_000 * Math.min(sizeMB / 100, 2));
    return Math.round(3_000 * Math.min(sizeMB / 10, 1.5));
  }

  private estimateMemory(entry: ModelManifestEntry, _ctx: SelectionContext): number {
    if (entry.peakMemoryBytes) return entry.peakMemoryBytes;
    return entry.sizeBytes * 4;
  }

  private buildSelectionReason(
    entry: ModelManifestEntry,
    ctx: SelectionContext,
    provider: ExecutionProvider,
    tiling: boolean,
    downscale: boolean,
  ): string {
    const parts: string[] = [];

    parts.push(`Model: ${entry.name}`);
    parts.push(`Quality: ${entry.quality}/5`);
    parts.push(`Precision: ${entry.precision}`);

    if (ctx.qualityMode === 'high-quality') parts.push('High quality mode');
    else if (ctx.qualityMode === 'fast') parts.push('Fast mode');
    else if (ctx.qualityMode === 'balanced') parts.push('Balanced mode');
    else if (ctx.qualityMode === 'auto') parts.push('Auto-selected');

    parts.push(`Provider: ${provider}`);

    if (entry.bundled) parts.push('Bundled (no download needed)');
    if (tiling) parts.push('Tile-based processing');
    if (downscale) parts.push('Input downscaled for performance');

    return parts.join(' · ');
  }

  private fallbackDecision(
    task: TaskCategory,
    rejections: SelectionDecision['rejections'],
  ): SelectionDecision {
    const bundled = this.findBundledFallback(task);
    if (bundled) {
      const tiling = !!bundled.inputSpec;
      return {
        modelId: bundled.id,
        precision: 'fp32',
        executionProvider: 'wasm',
        quality: bundled.quality,
        speed: 2,
        estimatedRuntimeMs: 10_000,
        estimatedPeakMemoryBytes: bundled.peakMemoryBytes || bundled.sizeBytes * 4,
        requireDownload: false,
        tiling,
        downscale: true,
        approximate: true,
        reason: 'Bundled fallback model selected (no downloaded models available)',
        rejections,
      };
    }
    return {
      modelId: '',
      precision: 'fp32',
      executionProvider: 'wasm',
      quality: 1,
      speed: 1,
      estimatedRuntimeMs: 0,
      estimatedPeakMemoryBytes: 0,
      requireDownload: false,
      tiling: false,
      downscale: false,
      approximate: true,
      reason: `No model available for task: ${task}`,
      rejections,
    };
  }

  private noModelDecision(task: TaskCategory): SelectionDecision {
    return {
      modelId: '',
      precision: 'fp32',
      executionProvider: 'wasm',
      quality: 1,
      speed: 1,
      estimatedRuntimeMs: 0,
      estimatedPeakMemoryBytes: 0,
      requireDownload: false,
      tiling: false,
      downscale: false,
      approximate: true,
      reason: `No models registered for task: ${task}`,
      rejections: [],
    };
  }

  private findBundledFallback(task: TaskCategory): ModelManifestEntry | null {
    for (const entry of this.manifest.values()) {
      if ((entry.category === task || this.taskAlias(entry.category) === task) && entry.bundled) {
        return entry;
      }
    }
    return null;
  }

  private findLighterEntry(
    candidates: ModelManifestEntry[],
    current: ModelManifestEntry,
  ): ModelManifestEntry | null {
    let lightest: ModelManifestEntry | null = null;
    for (const c of candidates) {
      const cPeak = c.peakMemoryBytes ?? c.sizeBytes * 4;
      const currPeak = current.peakMemoryBytes ?? current.sizeBytes * 4;
      if (cPeak < currPeak) {
        if (
          !lightest ||
          (c.peakMemoryBytes ?? c.sizeBytes * 4) <
            (lightest.peakMemoryBytes ?? lightest.sizeBytes * 4)
        ) {
          lightest = c;
        }
      }
    }
    return lightest;
  }

  private selectCustom(_ctx: SelectionContext): SelectionDecision {
    return this.noModelDecision('other');
  }

  explain(rejections: SelectionDecision['rejections']): string[] {
    return rejections.map((r) => `Rejected: ${r.modelId} (${r.precision}) — ${r.reason}`);
  }
}
