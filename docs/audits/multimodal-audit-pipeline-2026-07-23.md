# Multimodal Audit Pipeline

Generated: 2026-07-23
Purpose: Implement multimodal audit pipeline sourcing data from document structure, pixels, geometry, raster, interaction, codegen, and export artifacts

## Current State

### Current Data Sources

**Document Structure:**
- Scene intelligence audit (node properties, colors)
- Debt scanner (node properties, styles, components)
- Governance rules (node properties, styles, components)
- Linter (node properties, geometry)
- Codegen audits (node properties, path data, image metadata)
- Prototype validation (interaction data)

**Missing Data Sources:**
- No pixel-level analysis (except in design, not implemented)
- No geometry analysis (limited to simple bounds)
- No raster analysis (image metadata only, no pixel data)
- No interaction analysis (basic prototype validation only)
- No codegen artifact analysis (export output not analyzed)
- No accessibility testing (no screen reader, keyboard nav testing)

### Problems
1. **No pixel analysis:** Can't detect alpha fringes, banding, compression artifacts
2. **No geometry analysis:** Can't detect complex path issues, self-intersections
3. **No raster analysis:** Can't detect image quality issues beyond metadata
4. **No interaction analysis:** Can't detect prototype usability issues
5. **No codegen analysis:** Can't detect export output issues
6. **No accessibility testing:** Can't test real screen reader behavior
7. **No multimodal correlation:** Can't correlate findings across data sources

---

## Multimodal Pipeline Architecture

### Pipeline Stages

**Stage 1: Document Structure Analysis**
- Parse document tree
- Extract node properties
- Extract style references
- Extract component instances
- Extract interaction data

**Stage 2: Geometry Analysis**
- Calculate node bounds
- Calculate path geometry
- Calculate spatial relationships
- Calculate layout metrics
- Calculate overflow regions

**Stage 3: Pixel Analysis**
- Extract pixel data from image fills
- Analyze alpha channels
- Analyze color distribution
- Detect compression artifacts
- Detect banding

**Stage 4: Raster Analysis**
- Analyze image metadata
- Analyze color profiles
- Analyze resolution
- Analyze compression
- Analyze format compatibility

**Stage 5: Interaction Analysis**
- Parse prototype interactions
- Analyze flow graphs
- Analyze focus order
- Analyze touch targets
- Analyze state machines

**Stage 6: Codegen Analysis**
- Generate export artifacts
- Analyze generated code
- Analyze generated CSS
- Analyze generated SVG
- Analyze generated PDF

**Stage 7: Correlation**
- Correlate findings across stages
- Identify root causes
- Prioritize by impact
- Generate unified report

### Pipeline Flow

```
Document Input
    ↓
┌─────────────────────────────────────────┐
│ Stage 1: Document Structure Analysis    │
│ - Parse tree                            │
│ - Extract properties                     │
│ - Extract styles                         │
│ - Extract interactions                  │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Stage 2: Geometry Analysis               │
│ - Calculate bounds                      │
│ - Calculate path geometry                │
│ - Calculate spatial relationships        │
│ - Calculate layout metrics               │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Stage 3: Pixel Analysis (on-demand)     │
│ - Extract pixel data                    │
│ - Analyze alpha channels                │
│ - Analyze color distribution            │
│ - Detect artifacts                      │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Stage 4: Raster Analysis                │
│ - Analyze metadata                      │
│ - Analyze color profiles                 │
│ - Analyze resolution                    │
│ - Analyze compression                   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Stage 5: Interaction Analysis            │
│ - Parse interactions                     │
│ - Analyze flow graphs                   │
│ - Analyze focus order                   │
│ - Analyze touch targets                 │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Stage 6: Codegen Analysis (on-demand)   │
│ - Generate artifacts                    │
│ - Analyze generated code                │
│ - Analyze generated CSS                 │
│ - Analyze generated SVG                 │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Stage 7: Correlation                    │
│ - Correlate findings                    │
│ - Identify root causes                 │
│ - Prioritize by impact                  │
│ - Generate unified report               │
└─────────────────────────────────────────┘
    ↓
Unified Findings Output
```

---

## Stage 1: Document Structure Analysis

### Data Extraction

**Node Properties:**
```typescript
interface NodeProperties {
  id: NodeId;
  kind: NodeKind;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  fills: Fill[];
  strokes: Stroke[];
  effects: Effect[];
  children?: NodeId[];
}
```

**Style References:**
```typescript
interface StyleReference {
  nodeId: NodeId;
  styleId: string;
  styleType: 'fill' | 'stroke' | 'effect' | 'text';
}
```

**Component Instances:**
```typescript
interface ComponentInstance {
  instanceId: NodeId;
  componentId: string;
  overrides: Record<string, unknown>;
}
```

**Interaction Data:**
```typescript
interface InteractionData {
  nodeId: NodeId;
  interactionId: string;
  trigger: 'on-click' | 'on-hover' | 'on-drag' | 'on-scroll';
  actions: Action[];
}
```

### Analysis Rules

**Structure Rules:**
- Orphan styles (styles not used by any node)
- Unused components (components not instantiated)
- Duplicate styles (styles with identical properties)
- Excessive nesting (depth > 5)
- Unnamed layers (default name patterns)

**Governance Rules:**
- Untokenized colors (colors not in swatches)
- Inline spacing (non-grid spacing values)
- Naming violations (naming convention violations)
- Missing fonts (fonts not available)

---

## Stage 2: Geometry Analysis

### Geometry Extraction

**Node Bounds:**
```typescript
interface NodeBounds {
  nodeId: NodeId;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  pageId?: string;
}
```

**Path Geometry:**
```typescript
interface PathGeometry {
  nodeId: NodeId;
  path: PathData;
  anchorCount: number;
  segmentCount: number;
  area: number;
  perimeter: number;
  selfIntersecting: boolean;
  openEndpoints: number;
}
```

**Spatial Relationships:**
```typescript
interface SpatialRelationship {
  nodeId1: NodeId;
  nodeId2: NodeId;
  relationship: 'overlaps' | 'contains' | 'adjacent' | 'separated';
  distance: number;
  angle: number;
}
```

**Layout Metrics:**
```typescript
interface LayoutMetrics {
  nodeId: NodeId;
  gap: number;
  padding: [number, number, number, number];
  alignment: 'start' | 'center' | 'end' | 'space-between';
  distribution: 'start' | 'center' | 'end' | 'space-between';
}
```

### Analysis Rules

**Geometry Rules:**
- Zero-size layers (w=0 or h=0)
- Off-canvas layers (far outside canvas)
- Empty containers (no visible children)
- Self-intersecting paths
- Open paths (unclosed endpoints)
- Zero-area paths (area ≈ 0)
- Redundant groups (single child)

**Layout Rules:**
- Inline spacing (non-grid spacing)
- Inconsistent spacing (varying gaps)
- Misaligned elements (alignment violations)
- Overflow regions (content exceeds bounds)

---

## Stage 3: Pixel Analysis

### Pixel Extraction

**Image Data:**
```typescript
interface ImageData {
  nodeId: NodeId;
  imageId: string;
  width: number;
  height: number;
  pixelData: Uint8ClampedArray; // RGBA
  alphaChannel: Uint8ClampedArray;
}
```

**Alpha Analysis:**
```typescript
interface AlphaAnalysis {
  nodeId: NodeId;
  fringePixels: number;
  fringeThreshold: number;
  transparentPixels: number;
  semiTransparentPixels: number;
  opaquePixels: number;
}
```

**Color Distribution:**
```typescript
interface ColorDistribution {
  nodeId: NodeId;
  dominantColors: Array<{ color: [number, number, number, number]; count: number }>;
  colorCount: number;
  uniqueColors: number;
  gradientBands: number;
}
```

**Artifact Detection:**
```typescript
interface ArtifactDetection {
  nodeId: NodeId;
  compressionArtifacts: boolean;
  bandingRisk: boolean;
  posterization: boolean;
  noise: number;
  sharpness: number;
}
```

### Analysis Rules

**Pixel Rules:**
- Alpha fringe (semi-transparent pixels at edges)
- Banding risk (visible color bands in gradients)
- Compression artifacts (JPEG artifacts, PNG quantization)
- Posterization (reduced color depth)
- Excessive transparency (too many semi-transparent pixels)

---

## Stage 4: Raster Analysis

### Metadata Extraction

**Image Metadata:**
```typescript
interface ImageMetadata {
  nodeId: NodeId;
  imageId: string;
  format: 'png' | 'jpeg' | 'gif' | 'webp' | 'svg';
  width: number;
  height: number;
  dpi: number;
  colorSpace: 'rgb' | 'cmyk' | 'gray' | 'lab';
  colorProfile: string;
  bitDepth: number;
  compression: string;
  fileSize: number;
}
```

**Resolution Analysis:**
```typescript
interface ResolutionAnalysis {
  nodeId: NodeId;
  effectiveDPI: number;
  displayWidth: number;
  displayHeight: number;
  scaleFactor: number;
  minDPI: number;
  recommendedDPI: number;
}
```

**Color Profile Analysis:**
```typescript
interface ColorProfileAnalysis {
  nodeId: NodeId;
  documentColorSpace: string;
  imageColorSpace: string;
  profileMatch: boolean;
  conversionRequired: boolean;
  conversionQuality: 'lossless' | 'lossy';
}
```

### Analysis Rules

**Raster Rules:**
- Low resolution (below minimum DPI)
- Oversized assets (file size too large)
- Color profile mismatch (document vs image)
- Unsupported format (format not supported by export)
- Over-compression (quality too low)
- Missing alt text (accessibility metadata)

---

## Stage 5: Interaction Analysis

### Interaction Extraction

**Flow Graph:**
```typescript
interface FlowGraph {
  nodes: Array<{
    nodeId: NodeId;
    name: string;
    isHome: boolean;
  }>;
  edges: Array<{
    from: NodeId;
    to: NodeId;
    trigger: string;
    action: string;
  }>;
}
```

**Focus Order:**
```typescript
interface FocusOrder {
  entries: Array<{
    nodeId: NodeId;
    name: string;
    index: number;
    screenX: number;
    screenY: number;
  }>;
  issues: Array<{
    nodeId: NodeId;
    issue: 'unreachable' | 'duplicate-index' | 'out-of-order';
  }>;
}
```

**Touch Target Analysis:**
```typescript
interface TouchTargetAnalysis {
  nodeId: NodeId;
  width: number;
  height: number;
  minDimension: number;
  minSize: number;
  compliant: boolean;
  hidden: boolean;
}
```

### Analysis Rules

**Interaction Rules:**
- Broken targets (target node doesn't exist)
- Missing home screen (no entry point)
- Disabled interactions (interaction disabled)
- Orphan nodes (nodes with no interactions)
- Focus order issues (unreachable, duplicate indices)
- Touch target violations (below 44px minimum)

---

## Stage 6: Codegen Analysis

### Artifact Generation

**Generated Code:**
```typescript
interface GeneratedCode {
  nodeId: NodeId;
  format: 'html' | 'css' | 'svg' | 'react' | 'vue';
  code: string;
  size: number;
  dependencies: string[];
}
```

**Generated CSS:**
```typescript
interface GeneratedCSS {
  nodeId: NodeId;
  css: string;
  vendorPrefixes: string[];
  unsupportedProperties: string[];
  fallbackRequired: boolean;
}
```

**Generated SVG:**
```typescript
interface GeneratedSVG {
  nodeId: NodeId;
  svg: string;
  size: number;
  unsupportedFeatures: string[];
  fallbackRequired: boolean;
}
```

### Analysis Rules

**Codegen Rules:**
- Flattening required (effects not supported in CSS)
- Unsupported blend modes (blend mode not supported)
- Unsupported filters (filter not supported)
- Large file size (generated code too large)
- Missing accessibility labels (no aria-labels)
- Performance warnings (expensive CSS properties)

---

## Stage 7: Correlation

### Correlation Logic

**Root Cause Analysis:**
```typescript
interface RootCauseAnalysis {
  findingId: string;
  rootCause: string;
  relatedFindings: string[];
  confidence: number;
}
```

**Impact Analysis:**
```typescript
interface ImpactAnalysis {
  findingId: string;
  impact: 'blocking' | 'degrading' | 'cosmetic';
  affectedNodes: NodeId[];
  affectedExports: string[];
  affectedUsers: string[];
}
```

**Prioritization:**
```typescript
interface PriorityScore {
  findingId: string;
  score: number;
  factors: {
    severity: number;
    impact: number;
    confidence: number;
    fixability: number;
  };
}
```

### Correlation Examples

**Example 1: Contrast Issue Root Cause**
- Finding: Low contrast on "Header" node
- Correlated findings: Untokenized color on "Header"
- Root cause: Color not in swatches, using non-standard color
- Recommendation: Add color to swatches

**Example 2: Export Issue Root Cause**
- Finding: Flattening required for "Button" node
- Correlated findings: Unsupported blend mode on "Button"
- Root cause: Blend mode not supported in CSS
- Recommendation: Change blend mode or accept flattening

**Example 3: Performance Issue Root Cause**
- Finding: Large file size for export
- Correlated findings: Oversized image asset, high-resolution image
- Root cause: Image not optimized for web
- Recommendation: Optimize image resolution and compression

---

## Pipeline Implementation

### Pipeline Orchestrator

```typescript
class AuditPipeline {
  private stages: AuditStage[];
  private cache: PipelineCache;
  private config: PipelineConfig;
  
  constructor(config: PipelineConfig) {
    this.config = config;
    this.cache = new PipelineCache();
    this.stages = [
      new DocumentStructureStage(this.cache),
      new GeometryStage(this.cache),
      new PixelStage(this.cache),
      new RasterStage(this.cache),
      new InteractionStage(this.cache),
      new CodegenStage(this.cache),
      new CorrelationStage(this.cache),
    ];
  }
  
  async run(doc: Document, options: PipelineOptions): Promise<PipelineResult> {
    const context: PipelineContext = {
      doc,
      options,
      cache: this.cache,
      results: new Map<string, unknown>(),
    };
    
    // Run stages in sequence
    for (const stage of this.stages) {
      if (!this.shouldRunStage(stage, options)) continue;
      
      const stageResult = await stage.run(context);
      context.results.set(stage.id, stageResult);
    }
    
    // Correlate findings
    const correlationStage = this.stages[this.stages.length - 1];
    const correlationResult = await correlationStage.run(context);
    
    return {
      findings: correlationResult.findings,
      correlations: correlationResult.correlations,
      durationMs: context.durationMs,
    };
  }
  
  private shouldRunStage(stage: AuditStage, options: PipelineOptions): boolean {
    // Skip pixel stage unless explicitly requested
    if (stage.id === 'pixel' && !options.includePixelAnalysis) {
      return false;
    }
    
    // Skip codegen stage unless explicitly requested
    if (stage.id === 'codegen' && !options.includeCodegenAnalysis) {
      return false;
    }
    
    return true;
  }
}
```

### Stage Interface

```typescript
interface AuditStage {
  id: string;
  name: string;
  cost: ExecutionCost;
  run(context: PipelineContext): Promise<StageResult>;
}

interface PipelineContext {
  doc: Document;
  options: PipelineOptions;
  cache: PipelineCache;
  results: Map<string, unknown>;
  durationMs: number;
}

interface StageResult {
  findings: AuditFinding[];
  data: unknown;
  durationMs: number;
}

interface PipelineOptions {
  includePixelAnalysis: boolean;
  includeCodegenAnalysis: boolean;
  scopeIds?: NodeId[];
  pageId?: string;
  exportType?: ExportType;
}
```

---

## Implementation Priority

### Phase 1: Core Pipeline (Week 1-2)
1. Implement PipelineOrchestrator
2. Implement DocumentStructureStage
3. Implement GeometryStage
4. Implement basic CorrelationStage
5. Add pipeline cache

### Phase 2: Raster and Interaction (Week 3-4)
1. Implement RasterStage
2. Implement InteractionStage
3. Add raster analysis rules
4. Add interaction analysis rules
5. Enhance correlation

### Phase 3: Pixel and Codegen (Week 5-6)
1. Implement PixelStage
2. Implement CodegenStage
3. Add pixel analysis rules
4. Add codegen analysis rules
5. Add on-demand execution

### Phase 4: Advanced Correlation (Week 7-8)
1. Implement root cause analysis
2. Implement impact analysis
3. Implement prioritization
4. Add correlation UI
5. Add correlation export

---

## Testing Requirements

### Unit Tests
- Stage implementation for each stage
- Pipeline orchestrator logic
- Cache invalidation
- Correlation algorithms
- Root cause analysis

### Integration Tests
- Full pipeline with real document
- Stage-to-stage data flow
- Cache behavior
- Correlation with real findings

### E2E Tests
- Run pipeline on sample documents
- Verify findings from each stage
- Verify correlation results
- Test on-demand pixel analysis
- Test on-demand codegen analysis

### Performance Tests
- Measure pipeline execution time
- Measure stage execution time
- Measure cache hit rate
- Measure memory usage
- Measure pixel analysis time

---

## Documentation Updates

### User Documentation
- "Multimodal Audit" - How multimodal audit works
- "Pipeline Stages" - What each stage does
- "Pixel Analysis" - When pixel analysis runs
- "Codegen Analysis" - When codegen analysis runs

### Developer Documentation
- "Pipeline Architecture" - Technical overview
- "Stage Implementation" - How to implement stages
- "Correlation Logic" - How correlation works
- "Pipeline Cache" - Cache implementation
