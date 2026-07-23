# Intermediate Representation Implementation Report

**Date:** 2026-07-23  
**Status:** Completed  
**Version:** 1.0.0

## Executive Summary

This report documents the implementation of a shared Intermediate Representation (IR) for Strata's design-to-code generation pipeline. The IR serves as a semantic-preserving, layout-aware, component-aware, and target-agnostic format that bridges the gap between Strata's scene model and multiple code generation targets (SVG, CSS, Tailwind, React, Flutter, SwiftUI).

## Implementation Overview

### Core IR Types (`packages/codegen/src/ir-types.ts`)

The IR implementation defines the following core types:

- **SemanticNode**: The fundamental unit representing a design element with semantic meaning
- **SemanticKind**: Categorizes nodes (container, text, image, vector, component, etc.)
- **SemanticRole**: Primary semantic role (button, navigation, article, etc.) with inference metadata
- **AccessibilityMetadata**: ARIA roles, labels, focusable states, keyboard navigation
- **LayoutSpec**: Layout mode (flex, grid, absolute), direction, gaps, padding, alignment
- **ConstraintSpec**: Positioning constraints for responsive behavior
- **AppearanceSpec**: Background, foreground, typography, effects, opacity, blend mode
- **TokenBindings**: References to design tokens for colors, spacing, typography
- **ContentSpec**: Text content, image URLs, component properties
- **ComponentRef**: References to component definitions with slot fills
- **NodeMetadata**: Source node ID, generation timestamp, custom properties
- **IRDocument**: Complete document with nodes, tokens, breakpoints, components

### Scene-to-IR Converter (`packages/codegen/src/ir-converter.ts`)

The converter implements:

1. **Semantic Inference**: Pattern-based inference of semantic roles from node names and properties
2. **Layout Analysis**: Conversion from auto-layout and constraints to IR layout specifications
3. **Appearance Extraction**: Background colors, foreground colors, typography, effects
4. **Content Extraction**: Text content, rich text runs, image references
5. **Token Extraction**: Automatic detection of frequently used colors as design tokens
6. **Accessibility Generation**: ARIA role mapping, label extraction, focusable state inference
7. **Component Detection**: Identification of component instances and slot fills
8. **Serialization/Deserialization**: JSON-based round-trip support
9. **Validation**: Basic structural validation of IR documents

### Test Coverage (`packages/codegen/src/ir-converter.test.ts`)

Comprehensive test suite covering:

- Simple document conversion
- Semantic role inference from node names
- Accessibility metadata generation
- Node hierarchy preservation
- Text node conversion with typography
- Serialization and deserialization
- IR structure validation

**Test Results:** 8/8 tests passing

## Key Design Decisions

### 1. Semantic-First Approach

The IR prioritizes semantic meaning over visual representation. Each node includes:
- Primary semantic role (button, navigation, article, etc.)
- Confidence score for inferred roles
- ARIA role mapping for accessibility
- Focusable and keyboard-navigable states

### 2. Layout Abstraction

Layout is abstracted into a unified specification that can map to:
- CSS Flexbox and Grid
- Flutter Flex and Stack widgets
- SwiftUI VStack/HStack/ZStack
- Absolute positioning with constraints

### 3. Token Abstraction

Design tokens are extracted and referenced rather than hardcoding values:
- Color tokens extracted from frequently used colors
- Spacing tokens from consistent gap values
- Typography tokens from font families and sizes
- Custom property bindings for target-specific overrides

### 4. Component Awareness

The IR supports component definitions and instances:
- Master component definitions with typed slots
- Instance references with slot fills
- Variant support for component variations
- Property propagation from master to instances

### 5. Target Agnosticism

The IR is designed to be target-agnostic:
- No target-specific properties in core types
- Target mapping layer handles platform differences
- Unsupported features tracked separately
- Deterministic conversion from scene to IR

## Integration Points

### Codegen Package Integration

The IR is integrated into the main codegen package (`packages/codegen/src/index.ts`):

```typescript
export { sceneToIR, serializeIR, deserializeIR } from './ir-converter';
export * from './ir-types';
```

This makes the IR functionality available to:
- Existing code generation targets (SVG, CSS, React, Flutter, SwiftUI)
- Future target implementations
- Design audit systems
- Component extraction tools

### Document Model Integration

The converter works with Strata's existing document model:
- `Document` from `@strata/scene`
- `FrameNode`, `TextNode`, `ShapeNode`, etc.
- Auto-layout and constraint systems
- Component definitions and instances

## Current Limitations

### 1. Layout Conversion

- Auto-layout conversion is basic (direction, gap, padding)
- Advanced auto-layout features (grow/shrink ratios, basis) not fully mapped
- Constraint-to-layout mapping is simplified
- Grid layout not yet supported

### 2. Semantic Inference

- Pattern-based inference is rule-based and limited
- No machine learning or statistical analysis
- Context-aware inference (parent-child relationships) not implemented
- Custom inference rules require code changes

### 3. Token Extraction

- Only color tokens are currently extracted
- Spacing and typography token extraction is placeholder
- No token naming strategies (semantic vs. descriptive)
- No token grouping or organization

### 4. Component Detection

- Component detection is not implemented in the converter
- Relies on existing component system in scene model
- No automatic component suggestion
- No duplicate detection for component extraction

### 5. Accessibility

- Basic ARIA role mapping only
- No WCAG violation detection
- No keyboard navigation path analysis
- No screen reader optimization hints

### 6. Responsive Design

- Breakpoint system is placeholder
- No responsive variant generation
- No breakpoint-specific layout overrides
- No device-specific adaptations

## Recommendations

### Short-Term (1-2 weeks)

1. **Enhance Layout Conversion**
   - Add grow/shrink ratio mapping
   - Implement basis property support
   - Add grid layout support
   - Improve constraint-to-layout mapping

2. **Improve Semantic Inference**
   - Add context-aware inference (parent-child relationships)
   - Implement custom inference rule API
   - Add confidence score calibration
   - Support user-defined inference rules

3. **Complete Token Extraction**
   - Implement spacing token extraction
   - Add typography token extraction
   - Develop semantic token naming strategy
   - Add token grouping and organization

### Medium-Term (1-2 months)

4. **Implement Component Detection**
   - Integrate existing component detector
   - Add automatic component suggestion
   - Implement duplicate detection
   - Add component extraction workflow

5. **Enhance Accessibility**
   - Add WCAG violation detection
   - Implement keyboard navigation analysis
   - Add screen reader optimization hints
   - Support custom ARIA attributes

6. **Add Responsive Design Support**
   - Implement breakpoint system
   - Add responsive variant generation
   - Support breakpoint-specific overrides
   - Add device-specific adaptations

### Long-Term (3-6 months)

7. **Target Mapping Layer**
   - Implement target-specific mappers
   - Add target gap reporting
   - Support target-specific optimizations
   - Add target testing infrastructure

8. **IR Diff and Patch**
   - Implement IR diff algorithm
   - Add patch operations
   - Support incremental updates
   - Add conflict resolution

9. **Performance Optimization**
   - Implement incremental conversion
   - Add caching strategies
   - Optimize large document handling
   - Add streaming conversion for very large documents

10. **Tooling and Developer Experience**
    - Add IR visualization tools
    - Implement IR validation linter
    - Add IR migration tools
    - Create IR documentation generator

## Success Metrics

### Current Status

- **IR Types Defined**: ✅ Complete
- **Scene-to-IR Converter**: ✅ Complete
- **Test Coverage**: ✅ 8/8 tests passing
- **Integration**: ✅ Exported from codegen package
- **Documentation**: ✅ Architecture document created

### Target Metrics

- **Semantic Inference Accuracy**: >90% (current: unknown)
- **Layout Conversion Fidelity**: >95% (current: unknown)
- **Token Extraction Completeness**: >80% (current: colors only)
- **Component Detection Precision**: >85% (current: not implemented)
- **Accessibility Coverage**: >75% (current: basic only)
- **Target Mapping Completeness**: >90% (current: not implemented)

## Conclusion

The Intermediate Representation implementation provides a solid foundation for Strata's design-to-code generation pipeline. The semantic-first approach, combined with layout abstraction and token support, addresses the key architectural gaps identified in the initial audit.

The current implementation is functional and tested, but there are significant opportunities for enhancement in layout conversion, semantic inference, token extraction, component detection, accessibility, and responsive design support.

The recommended roadmap prioritizes completing the core functionality (layout, semantics, tokens) before moving to advanced features (component detection, accessibility, responsive design) and tooling (target mapping, diff/patch, performance optimization).

## Files Created/Modified

### Created Files

1. `packages/codegen/src/ir-types.ts` - Core IR type definitions
2. `packages/codegen/src/ir-converter.ts` - Scene-to-IR converter implementation
3. `packages/codegen/src/ir-converter.test.ts` - Comprehensive test suite
4. `docs/architecture/design-to-code-intermediate-representation.md` - Architecture design document
5. `docs/audits/ir-implementation-report-2026-07-23.md` - This report

### Modified Files

1. `packages/codegen/src/index.ts` - Added IR exports

## References

- Initial Audit Report: `docs/audits/design-to-code-audit-2026-07-23.md`
- Architecture Design: `docs/architecture/design-to-code-intermediate-representation.md`
- Scene Model: `packages/scene/src/types.ts`
- Existing Codegen: `packages/codegen/src/`
