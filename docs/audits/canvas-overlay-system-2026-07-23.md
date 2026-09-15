# Canvas Overlay System

Generated: 2026-07-23
Purpose: Design canvas overlay system for visual findings with accessibility support

## Current State

### Existing Canvas Overlays

**Current Overlays (from workspaceTypes.ts):**
- Rulers
- Guides
- Pixel grid
- Dot grid
- Bleed guides
- Layout grid
- Baseline grid

**Audit-Specific Overlays:**
- None currently exist

### Problems
1. **No audit visualization:** No visual indicators for audit findings on canvas
2. **No finding navigation:** Can't navigate between findings on canvas
3. **No finding highlighting:** Can't see which nodes have findings
4. **No overlay controls:** No way to toggle audit overlays
5. **No accessibility:** No screen reader support for overlays
6. **No performance consideration:** No density controls for many findings
7. **No workspace awareness:** Overlays don't respect workspace profiles

---

## Overlay Philosophy

### Core Principles

**1. Overlays must be non-intrusive**
- Overlays should not obstruct normal editing
- Overlays should be dismissible with single action
- Overlays should respect reduced motion preferences
- Overlays should work in high-contrast mode

**2. Overlays must be performant**
- Overlays should use efficient rendering
- Overlays should aggregate markers for density
- Overlays should lazy-render off-screen findings
- Overlays should debounce during rapid edits

**3. Overlays must be accessible**
- Overlays must have keyboard navigation
- Overlays must have screen reader announcements
- Overlays must respect high-contrast mode
- Overlays must have sufficient color contrast

**4. Overlays must be context-aware**
- Overlays should respect workspace profiles
- Overlays should respect filter settings
- Overlays should respect user preferences
- Overlays should adapt to zoom level

---

## Overlay Types

### Marker Overlays

**Purpose:** Indicate nodes with findings

**Visual Design:**
- Small colored badge on node corner
- Color indicates severity (red=error, orange=warning, blue=suggestion, gray=advisory)
- Number badge for multiple findings on same node
- Semi-transparent to not obstruct content

**Implementation:**
```typescript
interface FindingMarker {
  nodeId: NodeId;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  severity: AuditSeverity;
  count: number;
  findingIds: string[];
}
```

**Rendering:**
```
┌─────────────────┐
│ [●] Header      │  ← Red badge (error)
│                 │
└─────────────────┘
```

### Region Overlays

**Purpose:** Highlight specific regions with findings (contrast, overflow, etc.)

**Visual Design:**
- Colored outline or fill overlay
- Semi-transparent to show content underneath
- Color indicates severity
- Dashed line for warnings, solid for errors

**Implementation:**
```typescript
interface FindingRegion {
  findingId: string;
  region: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  severity: AuditSeverity;
  type: 'outline' | 'fill' | 'pattern';
}
```

**Rendering:**
```
┌─────────────────┐
│ ┌─────────────┐ │
│ │ Header      │ │  ← Red outline (contrast issue)
│ └─────────────┘ │
└─────────────────┘
```

### Arrow Overlays

**Purpose:** Show relationships or flow (focus order, prototype links)

**Visual Design:**
- Curved arrow from source to target
- Color indicates severity or type
- Arrowhead on target
- Semi-transparent

**Implementation:**
```typescript
interface FindingArrow {
  from: { nodeId: NodeId; x: number; y: number };
  to: { nodeId: NodeId; x: number; y: number };
  severity: AuditSeverity;
  type: 'focus-order' | 'prototype-link' | 'dependency';
}
```

**Rendering:**
```
┌─────────────────┐
│ Button ───────→ │  ← Arrow to next focus target
│ ┌─────────────┐ │
│ │ Next Button  │ │
│ └─────────────┘ │
└─────────────────┘
```

### Text Annotation Overlays

**Purpose:** Show text-based annotations directly on canvas

**Visual Design:**
- Small text label near node
- Background for readability
- Truncated if too long
- Dismissible

**Implementation:**
```typescript
interface FindingAnnotation {
  nodeId: NodeId;
  position: { x: number; y: number };
  text: string;
  severity: AuditSeverity;
}
```

**Rendering:**
```
┌─────────────────┐
│ Header          │
│ [2.1:1]         │  ← Text annotation (contrast ratio)
└─────────────────┘
```

### Aggregate Markers

**Purpose:** Handle density when many findings exist

**Visual Design:**
- Cluster marker for nearby findings
- Number badge showing count
- Expands on click to show individual markers
- Color indicates highest severity in cluster

**Implementation:**
```typescript
interface AggregateMarker {
  position: { x: number; y: number };
  count: number;
  maxSeverity: AuditSeverity;
  findingIds: string[];
  radius: number;
}
```

**Rendering:**
```
┌─────────────────┐
│ ●●●●●           │  ← Aggregate marker (5 findings)
│                 │
└─────────────────┘
```

---

## Overlay Configuration

### Workspace-Specific Overlays

**Design Workspace:**
```typescript
const DESIGN_OVERLAYS: OverlayConfig = {
  enabled: ['marker', 'region', 'annotation'],
  defaultSeverity: ['error', 'warning'],
  aggregateThreshold: 10,
  colorScheme: {
    error: '#ff4444',
    warning: '#ff8800',
    suggestion: '#4488ff',
    advisory: '#888888',
  },
};
```

**Drawing Workspace:**
```typescript
const DRAWING_OVERLAYS: OverlayConfig = {
  enabled: ['marker', 'region', 'arrow'],
  defaultSeverity: ['error', 'warning'],
  aggregateThreshold: 5,
  colorScheme: {
    error: '#ff4444',
    warning: '#ff8800',
    suggestion: '#4488ff',
    advisory: '#888888',
  },
};
```

**Print Workspace:**
```typescript
const PRINT_OVERLAYS: OverlayConfig = {
  enabled: ['marker', 'region', 'annotation'],
  defaultSeverity: ['error', 'warning'],
  aggregateThreshold: 15,
  colorScheme: {
    error: '#ff4444',
    warning: '#ff8800',
    suggestion: '#4488ff',
    advisory: '#888888',
  },
};
```

### User Preferences

```typescript
interface OverlayPreferences {
  /** Enabled overlay types */
  enabledOverlayTypes: OverlayType[];
  
  /** Severity levels to show */
  visibleSeverities: AuditSeverity[];
  
  /** Aggregate threshold (number of findings before aggregating) */
  aggregateThreshold: number;
  
  /** Marker size */
  markerSize: 'small' | 'medium' | 'large';
  
  /** Overlay opacity */
  overlayOpacity: number;
  
  /** Animation duration (ms) */
  animationDuration: number;
  
  /** Reduced motion mode */
  reducedMotion: boolean;
  
  /** High contrast mode */
  highContrast: boolean;
}
```

---

## Overlay Controls

### Toggle Controls

**Menu Location:** View → Show Audit Overlays

**Toggle Options:**
- Show Findings (master toggle)
- Show Errors
- Show Warnings
- Show Suggestions
- Show Advisories
- Show Markers
- Show Regions
- Show Annotations
- Show Arrows
- Aggregate Dense Findings

**Keyboard Shortcuts:**
- `Ctrl+Shift+O`: Toggle all audit overlays
- `Ctrl+Shift+E`: Toggle error overlays only
- `Ctrl+Shift+W`: Toggle warning overlays only

### Density Controls

**Automatic Aggregation:**
- When findings exceed threshold, automatically aggregate
- Threshold configurable per workspace
- User can manually expand/collapse clusters

**Manual Aggregation:**
- User can manually aggregate selected findings
- User can manually expand clusters

**Zoom-Based Density:**
- At high zoom, show individual markers
- At low zoom, show aggregate markers
- Transition threshold configurable

---

## Navigation

### Keyboard Navigation

**Navigate Between Findings:**
- `Ctrl+Shift+ArrowDown`: Next finding
- `Ctrl+Shift+ArrowUp`: Previous finding
- `Ctrl+Shift+ArrowRight`: Next finding in same category
- `Ctrl+Shift+ArrowLeft`: Previous finding in same category

**Navigate to Finding:**
- `Enter`: Select node and zoom to fit
- `Space`: Expand finding detail in panel
- `Escape`: Return to previous selection

**Toggle Overlay:**
- `Ctrl+Shift+O`: Toggle all overlays
- `Ctrl+Shift+H`: Hide all overlays

### Mouse Navigation

**Click Marker:**
- Select node on canvas
- Highlight finding in panel
- Zoom to fit node

**Click Region:**
- Select affected nodes
- Highlight findings in panel
- Zoom to fit region

**Click Aggregate:**
- Expand cluster
- Show individual markers
- Zoom to fit cluster

**Right-Click Marker:**
- Show context menu
- Options: View details, Fix, Suppress, Navigate

### Focus Order Navigation

**Focus Order Mode:**
- Show focus order arrows
- Navigate with Tab/Shift+Tab
- Visual indicator for current focus
- Escape to exit focus order mode

---

## Accessibility

### Screen Reader Support

**ARIA Live Regions:**
```
<div role="region" aria-live="polite" aria-label="Audit findings">
  <p>3 findings visible on canvas</p>
  <ul>
    <li>Error: Contrast issue on Header, 2.1:1 ratio</li>
    <li>Warning: Overset text on Body</li>
    <li>Suggestion: Unnamed layer on Rectangle 1</li>
  </ul>
</div>
```

**Finding Announcements:**
- When overlay is enabled: "Audit overlays enabled, 3 findings visible"
- When navigating to finding: "Selected finding: Contrast issue on Header, 2.1:1 contrast ratio"
- When finding is fixed: "Finding resolved: Contrast issue on Header"

**Keyboard Navigation:**
- All overlays must be keyboard accessible
- Focus indicators must be visible
- Escape key must exit overlay mode

### High Contrast Mode

**Color Adjustments:**
- Use system high-contrast colors
- Ensure sufficient contrast (4.5:1 minimum)
- Use patterns in addition to color
- Provide text labels for color-coded elements

**Pattern Support:**
- Error: Diagonal hatch pattern
- Warning: Dotted pattern
- Suggestion: Crosshatch pattern
- Advisory: Solid pattern

### Reduced Motion

**Animation Preferences:**
- Respect `prefers-reduced-motion`
- Disable all animations when reduced motion is enabled
- Use instant transitions instead of animated
- Disable marker bounce effects

---

## Performance

### Rendering Optimization

**Lazy Rendering:**
- Only render overlays for visible viewport
- Use viewport culling for off-screen findings
- Defer rendering of non-critical overlays

**Aggregate Rendering:**
- Use aggregate markers for dense clusters
- Render aggregate markers instead of individual markers
- Expand clusters only on demand

**Canvas Optimization:**
- Use efficient canvas rendering (WebGL if available)
- Cache overlay rendering where possible
- Use requestAnimationFrame for smooth updates

### Update Optimization

**Debounced Updates:**
- Debounce overlay updates during rapid edits
- Use 100ms debounce for marker updates
- Use 300ms debounce for region updates

**Incremental Updates:**
- Only update affected overlays on document change
- Use dirty tracking for overlay regions
- Re-render only changed overlays

**Background Updates:**
- Run expensive overlay calculations in background
- Use Web Workers for geometry calculations
- Show loading indicator for slow overlays

---

## Implementation Architecture

### Overlay Manager

```typescript
class OverlayManager {
  private overlays: Map<string, Overlay> = new Map();
  private preferences: OverlayPreferences;
  private viewport: Viewport;
  
  constructor(
    preferences: OverlayPreferences,
    viewport: Viewport
  ) {
    this.preferences = preferences;
    this.viewport = viewport;
  }
  
  /** Update overlays based on findings */
  updateFindings(findings: AuditFinding[]): void {
    // Clear existing overlays
    this.overlays.clear();
    
    // Create new overlays
    for (const finding of findings) {
      if (!this.shouldShowFinding(finding)) continue;
      
      const overlay = this.createOverlay(finding);
      this.overlays.set(finding.findingId, overlay);
    }
    
    // Aggregate if needed
    this.aggregateOverlays();
    
    // Render
    this.render();
  }
  
  /** Check if finding should be shown based on preferences */
  private shouldShowFinding(finding: AuditFinding): boolean {
    if (!this.preferences.visibleSeverities.includes(finding.severity)) {
      return false;
    }
    
    if (finding.suppression?.active) {
      return false;
    }
    
    return true;
  }
  
  /** Create overlay for a finding */
  private createOverlay(finding: AuditFinding): Overlay {
    const overlayType = this.determineOverlayType(finding);
    
    switch (overlayType) {
      case 'marker':
        return this.createMarkerOverlay(finding);
      case 'region':
        return this.createRegionOverlay(finding);
      case 'arrow':
        return this.createArrowOverlay(finding);
      case 'annotation':
        return this.createAnnotationOverlay(finding);
      default:
        return this.createMarkerOverlay(finding);
    }
  }
  
  /** Determine overlay type based on finding */
  private determineOverlayType(finding: AuditFinding): OverlayType {
    if (finding.category === 'focus-order') return 'arrow';
    if (finding.category === 'contrast' && finding.region) return 'region';
    if (finding.category === 'touch-target') return 'region';
    return 'marker';
  }
  
  /** Aggregate overlays if density exceeds threshold */
  private aggregateOverlays(): void {
    const findings = Array.from(this.overlays.values());
    
    if (findings.length <= this.preferences.aggregateThreshold) {
      return;
    }
    
    // Cluster findings by proximity
    const clusters = this.clusterFindings(findings);
    
    // Replace individual overlays with aggregate markers
    for (const cluster of clusters) {
      if (cluster.length > 1) {
        const aggregate = this.createAggregateMarker(cluster);
        for (const finding of cluster) {
          this.overlays.delete(finding.findingId);
        }
        this.overlays.set(`aggregate-${cluster[0].findingId}`, aggregate);
      }
    }
  }
  
  /** Render overlays to canvas */
  private render(): void {
    // Render to canvas
    const canvas = this.getCanvas();
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    for (const overlay of this.overlays.values()) {
      this.renderOverlay(ctx, overlay);
    }
  }
  
  /** Render single overlay */
  private renderOverlay(ctx: CanvasRenderingContext2D, overlay: Overlay): void {
    switch (overlay.type) {
      case 'marker':
        this.renderMarker(ctx, overlay);
        break;
      case 'region':
        this.renderRegion(ctx, overlay);
        break;
      case 'arrow':
        this.renderArrow(ctx, overlay);
        break;
      case 'annotation':
        this.renderAnnotation(ctx, overlay);
        break;
      case 'aggregate':
        this.renderAggregate(ctx, overlay);
        break;
    }
  }
}
```

### Overlay Types

```typescript
type OverlayType = 'marker' | 'region' | 'arrow' | 'annotation' | 'aggregate';

interface Overlay {
  type: OverlayType;
  findingId: string;
  position: { x: number; y: number };
  severity: AuditSeverity;
}

interface MarkerOverlay extends Overlay {
  type: 'marker';
  nodeId: NodeId;
  count: number;
}

interface RegionOverlay extends Overlay {
  type: 'region';
  region: { x: number; y: number; w: number; h: number };
  fill?: string;
  stroke?: string;
}

interface ArrowOverlay extends Overlay {
  type: 'arrow';
  from: { x: number; y: number };
  to: { x: number; y: number };
  curved: boolean;
}

interface AnnotationOverlay extends Overlay {
  type: 'annotation';
  text: string;
  background: string;
}

interface AggregateOverlay extends Overlay {
  type: 'aggregate';
  count: number;
  findingIds: string[];
  radius: number;
}
```

---

## Implementation Priority

### Phase 1: Core Overlays (Week 1-2)
1. Implement OverlayManager class
2. Implement marker overlays
3. Implement region overlays
4. Add overlay toggle controls
5. Add keyboard navigation

### Phase 2: Advanced Overlays (Week 3-4)
1. Implement arrow overlays (focus order)
2. Implement annotation overlays
3. Implement aggregate markers
4. Add density controls
5. Add zoom-based density

### Phase 3: Accessibility (Week 5-6)
1. Add screen reader support
2. Add high contrast mode
3. Add reduced motion support
4. Add keyboard navigation improvements
5. Add ARIA live regions

### Phase 4: Performance (Week 7-8)
1. Implement lazy rendering
2. Implement debounced updates
3. Implement background calculations
4. Add viewport culling
5. Add performance monitoring

---

## Testing Requirements

### Unit Tests
- Overlay creation for different finding types
- Overlay aggregation logic
- Overlay rendering
- Keyboard navigation
- Preference application

### Integration Tests
- Overlay manager with real findings
- Overlay updates on document change
- Overlay navigation with panel
- Overlay toggle controls
- Density controls

### E2E Tests
- Enable overlays and verify markers appear
- Navigate between findings with keyboard
- Click marker and verify node selection
- Toggle overlays and verify they hide
- Test high contrast mode
- Test reduced motion mode

### Accessibility Tests
- Screen reader announces findings
- Keyboard navigation works without mouse
- High contrast mode shows patterns
- Reduced motion disables animations
- Focus indicators are visible

---

## Documentation Updates

### User Documentation
- "Using Audit Overlays" - Guide for users
- "Overlay Controls" - How to toggle and configure overlays
- "Keyboard Navigation" - Keyboard shortcuts for overlays
- "Accessibility" - Screen reader and high contrast support

### Developer Documentation
- "Overlay System Architecture" - Technical overview
- "Overlay Manager" - API reference
- "Overlay Types" - Reference for overlay types
- "Performance Optimization" - Performance guidelines
