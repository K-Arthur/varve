# AI Transparency Controls Implementation Progress

## Overview
Implementing AI transparency controls for Varve per the user requirements:
1. Global AI kill switch
2. AI-edited labels on layers
3. Export metadata disclosure
4. Tests and documentation

Target: merged well before Nov 15, 2026

## Completed ✅

### 1. Settings Infrastructure
- ✅ Added `ai.enabled` boolean to `AiSettingsStore` (default: true for backward compat)
- ✅ Updated `DEFAULT_AI_SETTINGS` with default enabled
- ✅ Added documentation comments explaining the kill switch behavior

### 2. Feature Detection Helpers
- ✅ Created `useAiFeaturesEnabled()` hook for React components
- ✅ Created `getAiFeaturesEnabled()` sync function for non-React contexts
- ✅ Both functions safely handle missing/malformed settings

### 3. Layer Badge System
- ✅ Created `aiEditedBadge.ts` with helpers:
  - `getNodeAiEditInfo()`: Detects AI edits from generative edit provenance
  - `formatAiEditTimestamp()`: Formats relative/absolute timestamps
  - Returns tool name, model, timestamp for badge tooltip
- ✅ Added AI badge to `LayersRow.tsx`:
  - Shows sparkles icon when node has AI provenance
  - Tooltip shows "AI Fill • LaMa • 2h ago" style info
  - Integrated with existing badge system
- ✅ Added CSS styling in `layers.css`:
  - Subtle teal sparkles icon
  - Opacity 0.8 default, increases to 1.0 on hover/focus
  - Follows existing badge pattern

### 4. Git State
- ✅ Created feature branch: `cursor/ai-transparency-controls-a170`
- ✅ First commit: foundational changes
- ✅ Pushed to origin

## In Progress 🔧

### 5. AI Entry Point Gating
Need to wrap all AI feature entry points to check `useAiFeaturesEnabled()`:

**Locations identified:**
- `context.tsx` line 7076: `openCafDialog` - Generative Edit
- Background Removal dialog
- Upscale dialog
- Object Selection tool
- Visual search / embedding features
- Model download triggers

**Strategy:**
1. Add check in `openCafDialog` to show "AI features disabled" toast if off
2. Add conditional rendering in menus/toolbars (hide when disabled)
3. Gate model download/loading functions
4. Add command palette filtering for AI commands

## Todo 📋

### 6. Model Loading Prevention
- [ ] Add gate in model catalog download functions
- [ ] Add gate in inference pipeline initialization
- [ ] Prevent background embedding tasks when disabled
- [ ] Show clear error message if attempted

### 7. Export Metadata
- [ ] Research XMP metadata schema for AI disclosure
- [ ] Implement PNG/JPEG/WebP XMP writing (via `exiftool` or pure JS)
- [ ] Implement SVG `<metadata>` block for AI disclosure
- [ ] Add export dialog checkbox: "Include AI disclosure metadata" (default: checked)
- [ ] Implement C2PA feasibility research document

### 8. Inspector Section
- [ ] Create "AI Provenance" inspector section
- [ ] Show detailed edit history for selected node
- [ ] Add "View Mask" and "Restore Original" buttons
- [ ] Only show when node has AI provenance

### 9. Settings UI
- [ ] Add AI section to Settings dialog
- [ ] Add toggle for "Enable AI Features"
- [ ] Add explanation text about what gets disabled
- [ ] Consider adding to command palette as "Toggle AI Features"

### 10. Tests
- [ ] Unit test: AI badge appears on AI-edited nodes
- [ ] Unit test: AI badge not shown when no provenance
- [ ] Unit test: AI entry points respect enabled setting
- [ ] Unit test: Model downloads blocked when disabled
- [ ] E2E test: Save/load preserves AI badges
- [ ] E2E test: Export metadata survives round-trip where supported
- [ ] Test: Disabling AI doesn't break existing AI-edited content viewing

### 11. Documentation
- [ ] Create user-facing doc page: `docs/features/ai-transparency.md`
- [ ] Explain the kill switch and what it affects
- [ ] Document what gets labeled and how
- [ ] Document export disclosure behavior
- [ ] Add screenshots of badge and settings

### 12. C2PA Research
- [ ] Investigate C2PA/Content Credentials libraries (JS/WASM)
- [ ] Document feasibility and effort estimate
- [ ] Create follow-up plan if deferred
- [ ] Cost/benefit analysis for implementation priority

## Technical Notes

### AI Provenance Detection
Currently implemented for Generative Edit records in `Document.generativeEdits`.
Need to extend for:
- Background removal operations (when they persist provenance)
- Upscale operations
- Any future AI tools

### Export Metadata Formats
- **PNG/JPEG/WebP**: XMP metadata via IPTC `digitalSourceType` field
  - Value: `compositeWithTrainedAlgorithmicMedia`
  - Custom XMP for tool/model details
- **SVG**: `<metadata>` block with RDF or custom schema
- **PDF**: XMP in document metadata dictionary

### Build-time Policy Override
Consider adding env var `VARVE_DISABLE_AI_FEATURES=1` for:
- School/enterprise deployments
- Compliance scenarios
- Build-time feature flagging

## Validation Plan

Before marking complete:
1. Run `pnpm verify:plan` and `pnpm verify:affected`
2. Ensure no AI code runs when disabled (test with kill switch off)
3. Verify labels persist across save/load cycles
4. Test export metadata in all supported formats
5. Screenshot the layer badge and settings for PR description
6. Document any deferred work (C2PA, export formats) with follow-up plan

## PR Checklist

- [ ] AI kill switch implemented and respected everywhere
- [ ] Layer badges show on AI-edited content
- [ ] Export metadata implemented for major formats
- [ ] Tests pass (`pnpm verify:affected`)
- [ ] Documentation written
- [ ] Screenshots captured for PR
- [ ] C2PA feasibility documented
- [ ] Deferred work clearly explained

## Timeline Estimate

- Core implementation (kill switch + badges): ✅ **Complete**
- Entry point gating: 🔧 **In progress** (2-3 hours)
- Export metadata: 📋 **Todo** (4-6 hours)
- Tests: 📋 **Todo** (2-3 hours)
- Documentation: 📋 **Todo** (1-2 hours)
- C2PA research: 📋 **Todo** (2-3 hours)

**Total remaining: ~11-17 hours of work**

Target completion well before Nov 15, 2026 is achievable.
