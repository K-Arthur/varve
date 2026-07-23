# Design-to-Code and Design Quality Audit Report

**Date:** 2026-07-23  
**Scope:** Strata design-to-code generation and design-quality auditing systems  
**Repository:** K-Arthur/Strata

## Executive Summary

This audit evaluates Strata's current capabilities for converting designs to code and auditing design quality. The system has a solid foundation with multiple code generation targets and basic audit infrastructure, but lacks advanced features like semantic HTML inference, comprehensive component extraction, and specialized vector/raster auditing.

## 1. Repository and Capability Audit

### 1.1 Document Model Representation

**Location:** `packages/scene/src/types.ts`

**Supported Elements:**
- **Frames:** Layout-capable containers with auto-layout support
- **Pages:** Multi-page document structure
- **Components:** Typed slots, variants, property sets, master/instance model
- **Shapes:** rect, ellipse, circle, line, polygon, star, path
- **Text:** Rich text runs, OpenType features, variable font axes, text flow chains
- **Images:** Image fills with fit modes (fill, fit, stretch, tile)
- **Groups:** Container nodes without layout
- **Adjustments:** Non-destructive adjustment layers
- **Masks:** clip/alpha/luminance types with vector and raster support

**Layout and Constraints:**
- **Constraints:** Figma-style (min/max/center/stretch/scale) per axis
- **Auto-layout:** Flexbox-style (row/column, gap, padding, alignment, grow/shrink)
- **Layout sizing:** hug/fill modes
- **Responsive:** Breakpoint system in `packages/prototype/src/responsive.ts`

**Styles and Tokens:**
- **Color:** ManagedColor with RGB, CMYK, LAB, OKLCH spaces
- **Design tokens:** VariableStore with bindings support
- **Styles:** Shared style system with library
- **Effects:** Strokes, effects (blur, shadow), blend modes, opacity
- **Gradients:** Linear and radial gradients

**Status:** ✅ Well-designed, comprehensive model

### 1.2 Code Generation Paths

**Location:** `packages/codegen/`

**Current Export Functions:**
- `exportNodeToSvg()` - Single node SVG export
- `exportDocumentToSvg()` - Full document SVG export
- `exportNodeToCss()` - CSS class-based export
- `exportNodeToTailwind()` - React + Tailwind utility classes
- `exportNodeToCssModules()` - React + CSS Modules
- `exportNodeToFlutter()` - Flutter/Dart code
- `exportNodeToSwiftUI()` - SwiftUI code
- `exportDocumentToReact()` - Legacy React export
- `exportInteractivePrototype()` - Interactive prototype export
- `timelineToCSSKeyframes()` - Animation to CSS keyframes
- `timelineToLottieJSON()` - Animation to Lottie format
- `timelineToSVGAnimations()` - Animation to SVG SMIL

**Current Limitations:**
- All exports use absolute positioning by default
- Limited semantic HTML inference (no <button>, <nav>, <header> tags)
- No responsive breakpoint generation
- No component extraction or reuse detection
- Token resolution exists but not consistently applied
- No accessibility attribute inference (ARIA, roles)
- TargetGap reporting exists but not surfaced in UI

**Status:** ⚠️ Functional but basic, needs modernization

### 1.3 Audit Rules Infrastructure

**Location:** `packages/scene/src/intelligence/`

**Existing Audit Systems:**

1. **Contrast Audit** (`audit.ts`)
   - WCAG 2.1 compliance checking
   - Text vs background contrast ratios
   - Large text vs normal text thresholds
   - Auto-fix capability
   - Scope: Solid RGB fills only

2. **Debt Scanner** (`debtScanner.ts`)
   - 15 named checks for design debt
   - Untokenized colors
   - Inline spacing violations
   - Naming convention violations
   - Orphaned styles
   - Unused components
   - Missing fonts
   - Duplicate styles
   - Inconsistent border radius
   - Hardcoded font sizes
   - Mixed color spaces
   - Low contrast text
   - Overset text
   - Unnamed layers
   - Excessive nesting
   - Missing export presets

3. **Typography Preflight** (`typographyPreflight.ts`)
   - Missing font detection
   - Text overflow
   - Broken text chains
   - Unsupported glyphs
   - Variable axis validation
   - Style conflicts

4. **Print Preflight** (`printPreflight.ts`)
   - Bleed configuration
   - Color space validation
   - ICC profile checking
   - Resolution validation (min DPI)
   - Trim safety
   - Spot color detection
   - Font availability
   - Oversize document detection
   - Total Area Coverage (TAC) limits

5. **Governance Rules** (`governanceRules.ts`)
   - Naming conventions
   - Orphaned style detection
   - Unused component detection

6. **Linter Scanner** (`linterScanner.ts`)
   - Additional linting rules beyond debt scanner

**Status:** ✅ Strong foundation, comprehensive coverage

### 1.4 Design Token System

**Location:** `packages/ui/src/tokens/color.ts`

**Capabilities:**
- OKLCH perceptually uniform color space
- 12-step color ramps (blue, violet, amber, green, neutral, teal)
- Semantic token mapping
- Theme support (light, dark, high-contrast)
- WCAG 2.2 AA contrast enforcement via audit
- CSS custom property generation
- DTCG (Design Tokens Community Group) format support

**Status:** ✅ Modern, well-designed token system

### 1.5 Renderer Integration

**Location:** `packages/compositor/`

**Renderers:**
- Canvas2D backend
- WebGPU backend (in development)
- Compositor for effects and blending

**Status:** ✅ Dual-renderer architecture

### 1.6 Audit Result Attachment

**Current Model:**
- Audit issues attached to nodes via `nodeId` field
- Results returned as arrays of issue objects
- No persistent audit state in document
- No audit exception/ignore mechanism
- No audit history or diff tracking

**Status:** ⚠️ Transient only, needs persistence

## 2. Current Capability Matrix

| Capability | Status | Notes |
|-----------|--------|-------|
| **Document Model** | | |
| Frame/Page/Component representation | ✅ Complete | Full support with slots and variants |
| Constraint system | ✅ Complete | Figma-style constraints |
| Auto-layout | ✅ Complete | Flexbox-style layout engine |
| Text/typography | ✅ Complete | Rich text, OpenType, variable fonts |
| Vector paths | ✅ Complete | Full path support with handles |
| Images/masks | ✅ Complete | Multiple mask types, raster/vector |
| Effects/blending | ✅ Complete | Strokes, effects, blend modes |
| Variables/bindings | ✅ Complete | VariableStore with bindings |
| **Code Generation** | | |
| SVG export | ✅ Complete | Advanced with mask support |
| CSS export | ✅ Basic | Absolute positioning only |
| Tailwind export | ✅ Basic | Utility classes, absolute positioning |
| React export | ✅ Basic | Legacy, needs modernization |
| Flutter export | ✅ Basic | Functional |
| SwiftUI export | ✅ Basic | Functional |
| Semantic HTML | ❌ Missing | No semantic tag inference |
| Responsive code | ⚠️ Limited | No breakpoint generation |
| Component extraction | ❌ Missing | No reuse detection |
| Token-aware export | ⚠️ Partial | Resolution exists, not consistent |
| Accessibility attributes | ❌ Missing | No ARIA/role inference |
| **Audit Systems** | | |
| Contrast audit | ✅ Complete | WCAG 2.1 compliance |
| Typography audit | ✅ Complete | Missing fonts, overflow, chains |
| Print preflight | ✅ Complete | Production-ready checks |
| Design debt scanner | ✅ Complete | 15 comprehensive checks |
| Governance rules | ✅ Complete | Naming, orphan detection |
| Vector geometry audit | ❌ Missing | No path quality checks |
| Raster quality audit | ⚠️ Limited | Print DPI only |
| Color palette audit | ⚠️ Limited | Untokenized colors only |
| UI/UX design audit | ❌ Missing | No hierarchy/spacing checks |
| **Frontend Workflow** | | |
| Code preview UI | ✅ Complete | SpecPanel with syntax highlighting |
| Audit panel UI | ✅ Complete | IntelligencePanel with tabs |
| Responsive preview | ⚠️ Limited | Prototype breakpoint system |
| Visual issue overlays | ❌ Missing | No canvas overlays for issues |
| Audit exception management | ❌ Missing | No ignore/suppress mechanism |
| Export workflow | ✅ Complete | ExportDialog with presets |

## 3. Key Findings

### 3.1 Strengths

1. **Comprehensive Document Model:** The scene model is well-designed with support for modern design features (components with slots, variable fonts, multiple color spaces, advanced masking).

2. **Strong Audit Foundation:** The debt scanner, typography preflight, and print preflight systems provide comprehensive coverage of design quality issues.

3. **Modern Token System:** The OKLCH-based token system with WCAG enforcement is state-of-the-art.

4. **Multiple Export Targets:** Support for SVG, CSS, Tailwind, Flutter, and SwiftUI provides good coverage across platforms.

5. **Test Coverage:** Existing tests for codegen and audit systems provide a solid foundation.

### 3.2 Weaknesses

1. **Absolute Positioning Bias:** All code generation uses absolute positioning by default, ignoring the constraint and auto-layout systems that exist in the document model.

2. **No Semantic HTML:** Generated code uses generic `<div>` and `<span>` tags instead of semantic elements like `<button>`, `<nav>`, `<header>`.

3. **Missing Component Extraction:** No system to detect repeated patterns and extract reusable components.

4. **Limited Responsive Inference:** While the document model has constraints and auto-layout, code generation doesn't translate these into responsive CSS (media queries, container queries).

5. **No Vector/Raster Auditing:** Specialized audits for vector path quality and raster image quality are missing.

6. **No UI/UX Design Audit:** No checks for visual hierarchy, alignment, spacing consistency, or other design principles.

7. **Transient Audit State:** Audit results are not persisted in the document, and there's no mechanism to ignore intentional exceptions.

8. **Limited Accessibility:** No inference of ARIA attributes, roles, or other accessibility metadata.

### 3.3 Architecture Gaps

1. **No Shared Intermediate Representation:** Each code generator operates directly on the scene model without a normalized intermediate representation.

2. **No Layout Inference Engine:** No system to infer responsive behavior from constraints and auto-layout.

3. **No Component Detection:** No system to identify repeated structures and suggest component extraction.

4. **No Semantic Analysis:** No system to infer semantic roles from node structure and naming.

5. **No Audit Pipeline:** Audit systems are independent with no shared infrastructure for running, persisting, and managing results.

## 4. Recommendations

### 4.1 High Priority

1. **Implement Responsive Layout Inference:** Translate constraints and auto-layout into responsive CSS with media queries.

2. **Add Semantic HTML Inference:** Detect buttons, navigation, headers, and other semantic patterns from structure and naming.

3. **Create Shared Intermediate Representation:** Build a normalized IR that all code generators consume.

4. **Add Component Detection:** Identify repeated patterns and suggest component extraction.

5. **Implement Audit Persistence:** Store audit results in the document with ignore/suppress mechanisms.

### 4.2 Medium Priority

1. **Add Vector Geometry Audit:** Implement path quality checks (unnecessary points, self-intersections, etc.).

2. **Add Raster Quality Audit:** Extend beyond print DPI to include compression artifacts, resolution, and color profile checks.

3. **Implement UI/UX Design Audit:** Add checks for hierarchy, alignment, spacing, and visual balance.

4. **Add Accessibility Attribute Inference:** Generate ARIA roles and attributes based on semantic analysis.

5. **Create Visual Issue Overlays:** Show audit findings directly on the canvas with visual indicators.

### 4.3 Low Priority

1. **Add Color Palette Audit:** Analyze palette harmony, near-duplicate colors, and semantic consistency.

2. **Implement Advanced Component Extraction:** Detect near-duplicates with drift and suggest variant merging.

3. **Add Audit History:** Track audit results over time with diff visualization.

4. **Extend Token-Aware Export:** Make token resolution consistent across all export targets.

## 5. Implementation Plan

### Phase 1: Foundation (Weeks 1-2)
- Design and implement shared intermediate representation
- Create layout inference engine
- Add semantic HTML inference
- Implement audit persistence

### Phase 2: Code Generation Modernization (Weeks 3-4)
- Update CSS generator to use responsive layout
- Add semantic HTML to all generators
- Implement component detection
- Add accessibility attribute inference

### Phase 3: Audit Expansion (Weeks 5-6)
- Implement vector geometry audit
- Add raster quality audit
- Create UI/UX design audit
- Add visual issue overlays

### Phase 4: Frontend Workflow (Weeks 7-8)
- Create dedicated codegen workspace
- Implement audit exception management
- Add responsive preview with breakpoints
- Integrate all new features into UI

## 6. Testing Strategy

### Unit Tests
- Intermediate representation serialization/deserialization
- Layout inference algorithms
- Semantic detection rules
- Component detection similarity metrics
- Each audit rule independently

### Integration Tests
- End-to-end code generation with new IR
- Audit pipeline with persistence
- Responsive layout generation
- Semantic HTML output validation

### E2E Tests
- Full workflow: design → audit → fix → export
- Responsive preview across breakpoints
- Component extraction workflow
- Audit exception management

### Visual Regression Tests
- Generated code rendering verification
- Canvas overlay rendering
- Before/after audit fix visualization

## 7. Success Criteria

- [ ] All code generators use shared intermediate representation
- [ ] Responsive CSS generated from constraints and auto-layout
- [ ] Semantic HTML elements used where appropriate
- [ ] Component detection identifies 80% of repeated patterns
- [ ] Audit results persisted in document
- [ ] Vector geometry audit catches 90% of path issues
- [ ] Raster quality audit detects resolution and compression issues
- [ ] UI/UX audit identifies hierarchy and spacing problems
- [ ] Visual issue overlays render correctly on canvas
- [ ] All new features have comprehensive test coverage
- [ ] E2E workflow covers design → audit → fix → export
- [ ] No regression in existing codegen or audit functionality

## 8. Remaining Limitations

Even after implementation, the following limitations will remain:

1. **ML-Dependent Features:** Advanced semantic inference may require ML models for optimal accuracy.

2. **Complex Layouts:** Some complex layouts may not translate perfectly to responsive CSS.

3. **Design Intent:** Some design decisions are subjective and cannot be automated.

4. **Platform Differences:** Cross-platform code generation will always have some platform-specific limitations.

5. **Performance:** Large documents with many nodes may require optimization for audit performance.

## Conclusion

Strata has a strong foundation for design-to-code generation and design quality auditing. The document model is comprehensive, the audit systems are well-designed, and the token system is modern. The primary gaps are in translating the rich document model into modern, responsive, semantic code and expanding audit coverage to specialized areas like vector geometry and raster quality.

The recommended implementation plan addresses these gaps systematically while building on the existing strong foundation. The focus on shared intermediate representation, layout inference, and semantic analysis will significantly improve the quality of generated code and the comprehensiveness of design audits.
