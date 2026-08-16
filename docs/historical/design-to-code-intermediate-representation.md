# Design-to-Code Intermediate Representation Architecture

**Date:** 2026-07-23  
**Purpose:** Define a shared intermediate representation (IR) for Varve's design-to-code pipeline  
**Status:** Implemented — `SemanticNode` and the IR builders/converters live in
`@varve/codegen` (`packages/codegen/src/ir-types.ts`, `ir-builders.ts`,
`ir-converter.ts`, `ir-inference.ts`); written as a design document on
2026-07-23, the IR it specifies shipped in the design-to-code pipeline.

## Overview

This document defines a shared intermediate representation (IR) that normalizes Varve's scene model into a format optimized for code generation across multiple targets (HTML/CSS, React, Tailwind, Flutter, SwiftUI, SVG). The IR preserves semantic intent, layout behavior, and component structure while abstracting away implementation details.

## Design Principles

1. **Semantic Preservation:** Capture design intent (role, behavior, accessibility) not just visual appearance
2. **Layout Intent:** Translate constraints and auto-layout into responsive behavior specifications
3. **Component Awareness:** Preserve component boundaries, variants, and slot relationships
4. **Token Abstraction:** Separate design tokens from inline values for consistent theming
5. **Target Agnostic:** Represent concepts that can be mapped to any target format
6. **Deterministic:** Same input always produces same IR for reproducible builds
7. **Incremental:** Support partial regeneration without full document analysis

## Core IR Types

### 1. SemanticNode

The fundamental unit representing a design element with semantic meaning.

```typescript
interface SemanticNode {
  id: string;
  kind: SemanticKind;
  name: string;
  
  // Semantic role
  role: SemanticRole;
  accessibility: AccessibilityMetadata;
  
  // Layout specification
  layout: LayoutSpec;
  constraints: ConstraintSpec;
  
  // Visual appearance
  appearance: AppearanceSpec;
  tokens: TokenBindings;
  
  // Content
  content: ContentSpec;
  
  // Component relationship
  component?: ComponentRef;
  
  // Children
  children: SemanticNode[];
  
  // Metadata
  metadata: NodeMetadata;
}
```

### 2. SemanticKind

```typescript
type SemanticKind =
  | 'container'        // Generic container (div, view)
  | 'text'            // Text content
  | 'image'           // Image or graphic
  | 'button'          // Interactive button
  | 'link'            // Navigation link
  | 'input'           // Form input
  | 'list'            // List container
  | 'list-item'       // List item
  | 'navigation'      // Navigation container
  | 'header'          // Page or section header
  | 'footer'          // Page or section footer
  | 'main'            // Main content area
  | 'aside'           // Sidebar or aside content
  | 'article'         // Self-contained content
  | 'section'         // Thematic section
  | 'figure'          // Figure with caption
  | 'code'            // Code block
  | 'quote'           // Blockquote
  | 'divider'         // Visual separator
  | 'icon'            // Icon or symbol
  | 'avatar'          // User avatar
  | 'badge'           // Status badge
  | 'card'            // Card container
  | 'dialog'          // Dialog or modal
  | 'tooltip'         // Tooltip
  | 'progress'        // Progress indicator
  | 'skeleton'        // Loading skeleton
  | 'unknown';        // Fallback for unclassified elements
```

### 3. SemanticRole

```typescript
interface SemanticRole {
  primary: SemanticKind;
  inferred: boolean;
  confidence: number; // 0-1
  evidence?: string[]; // Reasons for this classification
}

interface AccessibilityMetadata {
  label?: string;
  description?: string;
  role?: AriaRole;
  properties?: Record<string, string>;
  liveRegion?: boolean;
  keyboardNavigable?: boolean;
  focusable?: boolean;
}
```

### 4. LayoutSpec

```typescript
interface LayoutSpec {
  mode: LayoutMode;
  direction: 'row' | 'column' | 'grid' | 'stack';
  
  // Spacing
  padding: Spacing;
  gap: Spacing;
  
  // Alignment
  alignItems: Alignment;
  justifyContent: Alignment;
  
  // Sizing
  width: SizingSpec;
  height: SizingSpec;
  
  // Responsive behavior
  responsive: ResponsiveSpec;
  
  // Overflow
  overflow: OverflowSpec;
}

type LayoutMode = 'flex' | 'grid' | 'absolute' | 'flow' | 'none';

interface Spacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

type Alignment = 'start' | 'center' | 'end' | 'stretch' | 'baseline';

interface SizingSpec {
  mode: 'fixed' | 'hug' | 'fill' | 'percent';
  value: number;
  min?: number;
  max?: number;
}

interface ResponsiveSpec {
  breakpoints: BreakpointBehavior[];
  containerQuery?: ContainerQuerySpec;
}

interface BreakpointBehavior {
  minWidth: number;
  maxWidth?: number;
  layout?: Partial<LayoutSpec>;
}

interface ContainerQuerySpec {
  containerName: string;
  minWidth: number;
  layout?: Partial<LayoutSpec>;
}

interface OverflowSpec {
  x: 'visible' | 'hidden' | 'scroll' | 'auto';
  y: 'visible' | 'hidden' | 'scroll' | 'auto';
}
```

### 5. ConstraintSpec

```typescript
interface ConstraintSpec {
  horizontal: ConstraintAxis;
  vertical: ConstraintAxis;
  preserveAspectRatio?: boolean;
}

type ConstraintAxis = 'min' | 'max' | 'center' | 'stretch' | 'scale' | 'fixed';
```

### 6. AppearanceSpec

```typescript
interface AppearanceSpec {
  // Colors
  background: ColorSpec;
  foreground: ColorSpec;
  border: BorderSpec;
  
  // Typography
  typography: TypographySpec;
  
  // Effects
  effects: EffectSpec[];
  
  // Transforms
  transform: TransformSpec;
  
  // Opacity and blending
  opacity: number;
  blendMode: BlendMode;
  
  // Border radius
  borderRadius: BorderRadiusSpec;
}

interface ColorSpec {
  type: 'solid' | 'gradient' | 'image' | 'token';
  value: string; // Token reference or color value
  fallback?: string; // Fallback if token not available
}

interface BorderSpec {
  width: number;
  color: ColorSpec;
  style: 'solid' | 'dashed' | 'dotted' | 'none';
}

interface TypographySpec {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  decoration?: 'none' | 'underline' | 'line-through';
}

interface EffectSpec {
  type: 'shadow' | 'blur' | 'backdrop-blur';
  params: Record<string, unknown>;
}

interface TransformSpec {
  translate: { x: number; y: number };
  rotate: number;
  scale: { x: number; y: number };
}

type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

interface BorderRadiusSpec {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}
```

### 7. TokenBindings

```typescript
interface TokenBindings {
  background?: string;
  foreground?: string;
  border?: string;
  spacing?: string;
  typography?: string;
  radius?: string;
  shadow?: string;
  custom?: Record<string, string>;
}
```

### 8. ContentSpec

```typescript
interface ContentSpec {
  type: 'text' | 'image' | 'icon' | 'none';
  text?: TextContent;
  image?: ImageContent;
  icon?: IconContent;
}

interface TextContent {
  value: string;
  runs?: TextRun[]; // For rich text
}

interface TextRun {
  text: string;
  style: Partial<TypographySpec>;
}

interface ImageContent {
  src: string;
  alt: string;
  fit: 'cover' | 'contain' | 'fill' | 'none';
  position: { x: number; y: number };
}

interface IconContent {
  name: string;
  set: string; // Icon set identifier
}
```

### 9. ComponentRef

```typescript
interface ComponentRef {
  componentId: string;
  variantId?: string;
  slots: Record<string, string>; // Slot name -> node ID
  overrides: Record<string, unknown>; // Property overrides
}
```

### 10. NodeMetadata

```typescript
interface NodeMetadata {
  sourceNodeId: string; // Original scene node ID
  exportId: string; // Stable ID for export tracking
  tags: string[];
  customData?: Record<string, unknown>;
}
```

## IR Document

```typescript
interface IRDocument {
  version: string;
  metadata: DocumentMetadata;
  nodes: Record<string, SemanticNode>;
  rootIds: string[];
  tokens: TokenLibrary;
  breakpoints: BreakpointConfig[];
  components: ComponentLibrary;
}

interface DocumentMetadata {
  documentId: string;
  name: string;
  generatedAt: number;
  generatorVersion: string;
  sourceFormat: 'strata' | 'figma' | 'sketch' | 'xd';
}

interface TokenLibrary {
  colors: Record<string, TokenValue>;
  spacing: Record<string, TokenValue>;
  typography: Record<string, TokenValue>;
  effects: Record<string, TokenValue>;
  custom: Record<string, TokenValue>;
}

interface TokenValue {
  value: string | number;
  type: 'color' | 'spacing' | 'dimension' | 'font' | 'other';
  description?: string;
}

interface BreakpointConfig {
  name: string;
  minWidth: number;
  maxWidth?: number;
  description?: string;
}

interface ComponentLibrary {
  [componentId: string]: ComponentDefinition;
}

interface ComponentDefinition {
  id: string;
  name: string;
  rootNode: string;
  slots: SlotDefinition[];
  variants: VariantDefinition[];
  properties: PropertyDefinition[];
}

interface SlotDefinition {
  id: string;
  name: string;
  required: boolean;
  defaultContent?: string;
}

interface VariantDefinition {
  id: string;
  name: string;
  overrides: Record<string, unknown>;
}

interface PropertyDefinition {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'color' | 'choice';
  default: unknown;
  choices?: string[];
}
```

## IR Generation Pipeline

### Phase 1: Scene Analysis

```typescript
interface SceneAnalysisResult {
  semanticMap: Map<string, SemanticRole>;
  layoutMap: Map<string, LayoutSpec>;
  componentMap: Map<string, ComponentRef>;
  tokenMap: Map<string, TokenBindings>;
}
```

**Steps:**
1. **Semantic Inference:** Analyze node names, structure, and patterns to infer semantic roles
2. **Layout Analysis:** Convert constraints and auto-layout into LayoutSpec
3. **Component Detection:** Identify component instances and extract slot relationships
4. **Token Extraction:** Identify reusable values and create token bindings

### Phase 2: IR Construction

```typescript
function buildIR(doc: Document, analysis: SceneAnalysisResult): IRDocument {
  // Convert each scene node to SemanticNode
  // Build token library from extracted tokens
  // Create component library from component definitions
  // Generate responsive breakpoints from constraints
}
```

### Phase 3: IR Validation

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

function validateIR(ir: IRDocument): ValidationResult {
  // Check for circular references
  // Validate token references
  // Verify layout consistency
  // Check responsive behavior
}
```

## Target Mapping

### HTML/CSS Mapping

```typescript
interface HTMLMapping {
  semanticKindToTag: Record<SemanticKind, string>;
  layoutToCSS: (layout: LayoutSpec) => string;
  appearanceToCSS: (appearance: AppearanceSpec) => string;
  tokensToCSSVars: (tokens: TokenBindings) => string;
}
```

**Example:**
- `SemanticKind.button` → `<button>`
- `LayoutMode.flex` → `display: flex`
- `TokenBindings.background` → `background: var(--token-name)`

### React Mapping

```typescript
interface ReactMapping {
  semanticKindToComponent: Record<SemanticKind, string>;
  layoutToProps: (layout: LayoutSpec) => Record<string, unknown>;
  appearanceToStyle: (appearance: AppearanceSpec) => Record<string, unknown>;
  tokensToTheme: (tokens: TokenBindings) => Record<string, unknown>;
}
```

**Example:**
- `SemanticKind.button` → `<Button>`
- `LayoutMode.flex` → `display: 'flex'`
- Token usage → `theme.tokens.background`

### Tailwind Mapping

```typescript
interface TailwindMapping {
  semanticKindToClass: (kind: SemanticKind) => string[];
  layoutToClasses: (layout: LayoutSpec) => string[];
  appearanceToClasses: (appearance: AppearanceSpec) => string[];
  tokensToArbitrary: (tokens: TokenBindings) => string[];
}
```

**Example:**
- `SemanticKind.button` → `['bg-primary', 'text-white', 'px-4', 'py-2', 'rounded']`
- Layout → `['flex', 'flex-row', 'gap-4']`

## Semantic Inference Rules

### Pattern-Based Inference

```typescript
interface InferenceRule {
  pattern: NodePattern;
  role: SemanticRole;
  confidence: number;
}

interface NodePattern {
  namePattern?: RegExp;
  kindPattern?: SceneNodeKind[];
  childPattern?: NodePattern[];
  parentPattern?: NodePattern;
  propertyPattern?: Record<string, unknown>;
}
```

**Example Rules:**
1. Name contains "button" → `SemanticKind.button`
2. Child of navigation → `SemanticKind.link`
3. Contains text + has click interaction → `SemanticKind.button`
4. Repeated card-like structure → `SemanticKind.card`

### Heuristic Scoring

```typescript
function inferSemanticRole(node: SceneNode, context: InferenceContext): SemanticRole {
  const scores = new Map<SemanticKind, number>();
  
  // Score based on name
  for (const rule of nameRules) {
    if (rule.pattern.test(node.name)) {
      scores.set(rule.role, (scores.get(rule.role) ?? 0) + rule.weight);
    }
  }
  
  // Score based on structure
  for (const rule of structureRules) {
    if (matchesStructure(node, rule.pattern)) {
      scores.set(rule.role, (scores.get(rule.role) ?? 0) + rule.weight);
    }
  }
  
  // Score based on properties
  for (const rule of propertyRules) {
    if (matchesProperties(node, rule.pattern)) {
      scores.set(rule.role, (scores.get(rule.role) ?? 0) + rule.weight);
    }
  }
  
  // Return highest-scoring role
  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    primary: best[0],
    inferred: true,
    confidence: best[1] / maxScore,
  };
}
```

## Layout Inference

### Constraint to LayoutSpec

```typescript
function constraintsToLayoutSpec(
  constraints: ConstraintSpec,
  parentLayout: LayoutSpec
): LayoutSpec {
  // Convert constraints to responsive layout
  // min → flex-start, max → flex-end, center → center
  // stretch → flex: 1, scale → percentage-based sizing
}
```

### Auto-Layout to LayoutSpec

```typescript
function autoLayoutToLayoutSpec(autoLayout: AutoLayout): LayoutSpec {
  return {
    mode: 'flex',
    direction: autoLayout.direction,
    padding: autoLayout.padding,
    gap: autoLayout.itemSpacing,
    alignItems: autoLayout.primaryAxisAlignItems,
    justifyContent: autoLayout.primaryAxisSizingMode,
    width: sizingFromMode(autoLayout.primaryAxisSizingMode),
    height: sizingFromMode(autoLayout.counterAxisSizingMode),
  };
}
```

### Responsive Breakpoint Generation

```typescript
function generateBreakpoints(
  constraints: ConstraintSpec[],
  variants: VariantDefinition[]
): BreakpointConfig[] {
  // Analyze constraint variations across variants
  // Generate breakpoints where layout changes significantly
  // Default breakpoints: 640px, 768px, 1024px, 1280px, 1536px
}
```

## Component Extraction

### Similarity Detection

```typescript
interface SimilarityScore {
  structural: number; // 0-1
  visual: number; // 0-1
  overall: number; // 0-1
}

function computeSimilarity(a: SemanticNode, b: SemanticNode): SimilarityScore {
  // Compare structure (child count, nesting depth)
  // Compare visual properties (colors, typography, spacing)
  // Weighted combination for overall score
}
```

### Component Suggestion

```typescript
interface ComponentSuggestion {
  nodes: string[];
  similarity: number;
  suggestedName: string;
  slots: SlotSuggestion[];
  confidence: number;
}

function suggestComponents(ir: IRDocument): ComponentSuggestion[] {
  // Find groups of similar nodes
  // Cluster by similarity score
  // Suggest component extraction for high-confidence groups
}
```

## Token Extraction

### Color Token Extraction

```typescript
function extractColorTokens(nodes: SemanticNode[]): TokenLibrary {
  const colorFrequency = new Map<string, number>();
  
  for (const node of nodes) {
    const color = node.appearance.background.value;
    colorFrequency.set(color, (colorFrequency.get(color) ?? 0) + 1);
  }
  
  // Create tokens for colors used >= 3 times
  const tokens: Record<string, TokenValue> = {};
  for (const [color, count] of colorFrequency) {
    if (count >= 3) {
      const name = generateColorName(color);
      tokens[name] = { value: color, type: 'color' };
    }
  }
  
  return { colors: tokens };
}
```

### Spacing Token Extraction

```typescript
function extractSpacingTokens(nodes: SemanticNode[]): TokenLibrary {
  const spacingFrequency = new Map<number, number>();
  
  for (const node of nodes) {
    const spacing = node.layout.gap;
    spacingFrequency.set(spacing, (spacingFrequency.get(spacing) ?? 0) + 1);
  }
  
  // Create tokens for spacing values used >= 3 times
  // Round to nearest 4px base unit
}
```

## IR Serialization

### JSON Format

```typescript
function serializeIR(ir: IRDocument): string {
  return JSON.stringify(ir, null, 2);
}

function deserializeIR(json: string): IRDocument {
  return JSON.parse(json);
}
```

### Binary Format (Optional)

For large documents, consider a binary format using Protocol Buffers or similar for faster serialization.

## IR Diff and Patching

```typescript
interface IRDiff {
  version: string;
  timestamp: number;
  changes: NodeChange[];
}

interface NodeChange {
  nodeId: string;
  type: 'add' | 'remove' | 'modify';
  before?: SemanticNode;
  after?: SemanticNode;
}

function computeIRDiff(before: IRDocument, after: IRDocument): IRDiff {
  // Compute minimal diff between two IR versions
}

function applyIRPatch(ir: IRDocument, diff: IRDiff): IRDocument {
  // Apply diff to create new IR version
}
```

## Testing Strategy

### Unit Tests

- IR construction from scene nodes
- Semantic inference accuracy
- Layout inference correctness
- Token extraction completeness
- Component detection precision/recall

### Integration Tests

- End-to-end IR generation from sample documents
- Target mapping correctness for each format
- IR serialization/deserialization
- IR diff/patch operations

### Regression Tests

- Compare IR output for known documents
- Ensure IR stability across generator versions
- Validate IR doesn't lose information from scene model

## Performance Considerations

### Incremental Generation

- Cache IR results per node
- Only regenerate changed subtrees
- Use dependency tracking for invalidation

### Memory Management

- Stream large documents instead of loading entirely
- Use object pooling for frequent allocations
- Implement IR size limits and chunking

### Parallel Processing

- Process independent subtrees in parallel
- Parallelize semantic inference
- Parallelize token extraction

## Migration Strategy

### Phase 1: IR Implementation (Weeks 1-2)
- Implement core IR types
- Build scene-to-IR converter
- Add IR validation
- Write unit tests

### Phase 2: Target Adapters (Weeks 3-4)
- Implement HTML/CSS adapter
- Implement React adapter
- Implement Tailwind adapter
- Update existing adapters to use IR

### Phase 3: Advanced Features (Weeks 5-6)
- Implement semantic inference
- Add component extraction
- Implement token extraction
- Add responsive breakpoint generation

### Phase 4: Integration (Weeks 7-8)
- Integrate IR into existing codegen pipeline
- Update UI to show IR-based warnings
- Add IR inspection tools
- Performance optimization

## Success Metrics

- **Accuracy:** Semantic inference > 80% accuracy on benchmark
- **Coverage:** Component extraction > 70% of repeated patterns
- **Performance:** IR generation < 100ms for 1000-node document
- **Stability:** IR output deterministic across runs
- **Completeness:** No information loss from scene to IR
- **Adoption:** All code generators using IR within 8 weeks

## Open Questions

1. **ML Integration:** Should we use ML for semantic inference, or stick to rule-based?
2. **User Overrides:** How should users correct semantic inference errors?
3. **IR Persistence:** Should IR be stored in the document or generated on-demand?
4. **Custom Components:** How should users define custom semantic kinds?
5. **Token Scope:** Should tokens be global, document-level, or component-level?

## References

- WCAG 2.2 Accessibility Guidelines
- HTML5 Semantic Elements
- CSS Grid and Flexbox Specifications
- React Component Patterns
- Flutter Widget Catalog
- SwiftUI View Library
- Design Tokens Community Group (DTCG)
- Figma Dev Mode Documentation
- Adobe XD Code Export Documentation
