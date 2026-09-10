# Panel and Navigation Architecture

Generated: 2026-07-23
Purpose: Design audit panel architecture that avoids permanent top-level Audit tab in every workspace

## Current Architecture Analysis

### Current State
- **Audit tab** is a permanent inspector tab in: design, print, image, motion workspaces
- **Not present** in: drawing workspace
- **Overflow priority:** 5 (may be moved to overflow menu on narrow screens)
- **Always visible** regardless of whether there are findings
- **Same content** across all workspaces (no workspace-specific filtering)

### Problems
1. **Panel clutter:** Audit tab takes space even when not relevant (e.g., drawing workspace)
2. **No hierarchy:** All audit categories shown equally, no prioritization
3. **Workspace mismatch:** Vector-specific rules shown in image workspace, etc.
4. **No contextual access:** Users must navigate to Audit tab to see any findings
5. **No progressive disclosure:** No way to show summary first, details later
6. **Command inconsistency:** Commands open Audit tab but don't respect workspace context

### Current Inspector Tab Structure
```
Design Workspace:
├─ Properties (primary)
├─ Appearance & Effects (workflow)
├─ Prototype (workflow)
├─ Export (output)
└─ Audit (output, overflow: 5)

Print Workspace:
├─ Properties (primary)
├─ Appearance & Effects (workflow)
├─ Audit (output, overflow: 5)
└─ Export (output)

Image Workspace:
├─ Properties (primary)
├─ Adjustments (workflow)
├─ Appearance & Effects (workflow)
├─ Export (output)
└─ Audit (output, overflow: 5)

Motion Workspace:
├─ Properties (primary)
├─ Appearance & Effects (workflow)
├─ Prototype (workflow)
├─ Export (output)
└─ Audit (output, overflow: 5)

Drawing Workspace:
├─ Properties (primary)
├─ Appearance & Effects (workflow)
└─ Export (output)
```

---

## Proposed Architecture

### Core Principle
**Audit is a utility, not a primary workflow.** Make it accessible on-demand without permanent panel space.

### Architecture Options

#### Option A: Utility Panel Group (Recommended)
Create a new "Utility" panel group that houses Audit and other infrequently used panels.

**Structure:**
```
Utility Panel Group (collapsible, right sidebar):
├─ Audit (default when expanded)
├─ Developer Handoff (code specs)
├─ Version History (if implemented)
└─ Extensions (third-party tools)
```

**Behavior:**
- Collapsed by default in all workspaces
- Expands when:
  - User clicks status bar badge
  - User runs audit command
  - Critical errors detected
  - User explicitly expands via menu
- Auto-collapses after user navigates away
- Keyboard shortcut: Ctrl+Shift+A to toggle

**Workspace Configuration:**
```typescript
const UTILITY_PANEL_CONFIG: Partial<WorkspaceConfig> = {
  panels: {
    // Existing panels...
    utility: { 
      visible: true, 
      collapsed: true,  // Default collapsed
      order: 4, 
      preferredWidth: '20rem' 
    },
  },
  inspectorTabs: [
    // Remove Audit from inspectorTabs in all workspaces
    // Audit is now in utility panel
  ],
};
```

**Pros:**
- Frees up inspector tab space
- Groups utility functions together
- Collapsible when not needed
- Consistent across workspaces
- Easy to discover (status badge links to it)

**Cons:**
- New panel group to learn
- Requires UI changes to inspector layout
- May feel "hidden" if not discoverable

#### Option B: Contextual Tab Injection
Inject Audit tab only when relevant to current workspace/selection.

**Behavior:**
- Design workspace: Audit tab visible (default profile: General)
- Drawing workspace: Audit tab visible only when vector nodes selected
- Image workspace: Audit tab visible only when image nodes selected
- Print workspace: Audit tab always visible (default profile: Print)
- Motion workspace: Audit tab visible only in prototype mode

**Implementation:**
```typescript
interface DynamicTabConfig {
  tabId: InspectorTabId;
  visible: boolean;
  condition: (state: EditorState) => boolean;
  workspace?: WorkspaceMode;
}

const DYNAMIC_AUDIT_TAB: DynamicTabConfig = {
  tabId: 'audit',
  visible: false, // Computed dynamically
  condition: (state) => {
    switch (state.workspaceMode) {
      case 'design':
        return true; // Always visible in design
      case 'drawing':
        return state.selection.some(id => 
          isVectorNode(state.document.nodes[id])
        );
      case 'image':
        return state.selection.some(id => 
          isImageNode(state.document.nodes[id])
        );
      case 'print':
        return true; // Always visible in print
      case 'motion':
        return state.prototypeMode; // Only in prototype mode
      default:
        return false;
    }
  },
};
```

**Pros:**
- No new panel group
- Familiar tab interface
- Context-aware visibility
- Minimal UI changes

**Cons:**
- Tab still takes space when visible
- Visibility changes may be confusing
- Harder to discover when hidden
- Still clutters inspector in design workspace

#### Option C: Status Bar + Command Only
Remove Audit tab entirely, rely on status bar and commands.

**Behavior:**
- No Audit tab in any workspace
- Status bar badge shows issue count
- Click badge opens modal/drawer with audit interface
- Commands open modal/drawer
- Modal is dismissible, not permanent

**Implementation:**
```typescript
interface AuditDrawer {
  isOpen: boolean;
  profile: AuditProfileId;
  findings: AuditFinding[];
  position: 'right' | 'left' | 'modal';
}
```

**Pros:**
- Maximum space savings
- No panel clutter
- Simple mental model
- Works on small screens

**Cons:**
- Modal may feel disconnected
- Can't keep open while working
- May feel "hidden"
- Breaks existing user patterns

#### Option D: Hybrid Approach (Recommended)
Combine Option A (Utility Panel) with Option B (Contextual Tab) for optimal experience.

**Behavior:**
- **Primary access:** Utility panel (collapsed by default)
- **Secondary access:** Contextual tab injection when highly relevant
- **Tertiary access:** Status badge + commands
- **Workspace-specific:**
  - Design: Utility panel + contextual tab (high relevance)
  - Print: Utility panel + contextual tab (high relevance)
  - Drawing: Utility panel only (low relevance unless vector selected)
  - Image: Utility panel only (low relevance unless image selected)
  - Motion: Utility panel only (low relevance unless prototype mode)

**Configuration:**
```typescript
const HYBRID_AUDIT_CONFIG: Record<WorkspaceMode, {
  utilityPanel: { visible: boolean; defaultCollapsed: boolean };
  contextualTab: { visible: boolean; condition?: (state: EditorState) => boolean };
}> = {
  design: {
    utilityPanel: { visible: true, defaultCollapsed: true },
    contextualTab: { visible: true }, // Always visible in design
  },
  print: {
    utilityPanel: { visible: true, defaultCollapsed: true },
    contextualTab: { visible: true }, // Always visible in print
  },
  drawing: {
    utilityPanel: { visible: true, defaultCollapsed: true },
    contextualTab: { 
      visible: false, 
      condition: (state) => hasVectorSelection(state) 
    },
  },
  image: {
    utilityPanel: { visible: true, defaultCollapsed: true },
    contextualTab: { 
      visible: false, 
      condition: (state) => hasImageSelection(state) 
    },
  },
  motion: {
    utilityPanel: { visible: true, defaultCollapsed: true },
    contextualTab: { 
      visible: false, 
      condition: (state) => state.prototypeMode 
    },
  },
};
```

**Pros:**
- Best of both worlds
- Flexible access patterns
- Workspace-appropriate exposure
- Backward compatible (tab still exists in design/print)

**Cons:**
- More complex implementation
- Two access patterns to learn
- Configuration overhead

---

## Recommended Implementation: Hybrid Approach

### Phase 1: Utility Panel Foundation
1. Add `utility` panel to workspace configurations
2. Move Audit panel content to utility panel
3. Add collapse/expand behavior
4. Wire up status badge to expand utility panel
5. Add keyboard shortcut (Ctrl+Shift+A)

### Phase 2: Contextual Tab Logic
1. Implement dynamic tab visibility system
2. Add conditional audit tab for drawing/image/motion
3. Test tab visibility changes with selection
4. Add visual indicator when tab is conditionally hidden

### Phase 3: Polish and Integration
1. Add animation for panel expand/collapse
2. Add "Back to [Workspace]" button in utility panel
3. Implement workspace switching with context preservation
4. Add deep linking support
5. Update documentation

---

## Navigation Patterns

### Opening Audit

**From Status Bar:**
- Click document health badge → Expand utility panel with Audit
- Click export readiness badge → Expand utility panel with Export + Audit preflight
- Click selection count → Expand utility panel with Audit filtered to selection

**From Commands:**
- `openAuditPanel` → Expand utility panel with current profile
- `runAudit` → Expand utility panel with General profile
- `scanDebt` → Expand utility panel with Debt profile
- `checkAccessibility` → Expand utility panel with Linter profile
- `validatePrototype` → Expand utility panel with Prototype profile

**From Contextual Tab:**
- Click Audit tab → Switch to Audit (if contextual tab visible)
- Tab behaves like normal inspector tab

**From Contextual Summary:**
- Click "View all issues" → Expand utility panel with relevant category
- Click finding → Expand utility panel with that finding selected

### Closing Audit

**Manual Close:**
- Click collapse button on utility panel
- Press Escape (if utility panel has focus)
- Click "Close" button in utility panel header

**Auto-Close:**
- When switching to unrelated workspace
- When selection changes to unrelated type (if selection-scoped)
- After 5 minutes of inactivity (configurable)
- When user navigates to different inspector tab

**Persist When:**
- User explicitly pinned (pin button in header)
- Critical errors exist (configurable)
- User is in dedicated Audit workspace

### Workspace Switching

**Switching Between Workspaces:**
1. Save current audit state (profile, filters, selected finding)
2. Switch workspace
3. Restore audit state if audit panel was open
4. Apply workspace-specific profile
5. Re-run audit with new profile

**Context Preservation:**
- Selected finding ID preserved if finding still exists in new workspace
- Filters reset to workspace defaults
- Profile switches to workspace default
- Scroll position reset

**Example Flow:**
```
User in Design workspace:
- Audit panel open with General profile
- Selected finding: contrast-aa-fail on node "Header"
- Filters: Severity=Error, Category=Contrast

User switches to Drawing workspace:
- Audit panel remains open
- Profile switches to Vector
- Selected finding cleared (contrast not in Vector profile)
- Filters reset to Vector defaults
- New findings: open-path, self-intersection
```

### Deep Linking

**URI Scheme:**
```
strata://audit?workspace=design&profile=general&category=contrast&finding=finding-123&panel=utility
```

**Parameters:**
- `workspace`: Target workspace mode
- `profile`: Audit profile to use
- `category`: Category to filter to
- `finding`: Specific finding ID to select
- `panel`: Which panel to open (utility or contextual tab)
- `overlay`: Canvas overlay to enable

**Deep Link Behavior:**
1. Parse URI parameters
2. Switch to specified workspace (if different)
3. Open specified panel (utility or contextual tab)
4. Apply specified profile
5. Filter to specified category
6. Select specified finding
7. Enable specified overlay
8. Focus finding in panel
9. Navigate to node on canvas

**Deep Link Use Cases:**
- External CI/CD tools linking to specific issues
- Report exports with clickable findings
- Team collaboration (share finding link)
- Automation (open specific audit state)

---

## Panel Configuration Schema

### Workspace Configuration Extension

```typescript
interface WorkspaceConfig {
  // Existing fields...
  
  /** Audit panel configuration */
  audit: {
    /** Primary access method */
    primaryAccess: 'utility' | 'contextual-tab' | 'drawer';
    
    /** Utility panel configuration */
    utilityPanel?: {
      visible: boolean;
      defaultCollapsed: boolean;
      preferredWidth: string;
      autoCollapseAfterMs?: number;
    };
    
    /** Contextual tab configuration */
    contextualTab?: {
      visible: boolean;
      condition?: (state: EditorState) => boolean;
      overflowPriority?: number;
    };
    
    /** Default audit profile for this workspace */
    defaultProfile: AuditProfileId;
    
    /** Status bar indicators */
    statusIndicators: {
      documentHealth: boolean;
      exportReadiness: boolean;
      selectionCount: boolean;
    };
  };
}
```

### Example Configurations

**Design Workspace:**
```typescript
design: {
  // ... existing config
  audit: {
    primaryAccess: 'utility',
    utilityPanel: {
      visible: true,
      defaultCollapsed: true,
      preferredWidth: '20rem',
      autoCollapseAfterMs: 300000, // 5 minutes
    },
    contextualTab: {
      visible: true,
      overflowPriority: 5,
    },
    defaultProfile: 'general',
    statusIndicators: {
      documentHealth: true,
      exportReadiness: true,
      selectionCount: true,
    },
  },
}
```

**Drawing Workspace:**
```typescript
drawing: {
  // ... existing config
  audit: {
    primaryAccess: 'utility',
    utilityPanel: {
      visible: true,
      defaultCollapsed: true,
      preferredWidth: '20rem',
    },
    contextualTab: {
      visible: false,
      condition: (state) => hasVectorSelection(state),
    },
    defaultProfile: 'vector',
    statusIndicators: {
      documentHealth: false,
      exportReadiness: false,
      selectionCount: true,
    },
  },
}
```

**Print Workspace:**
```typescript
print: {
  // ... existing config
  audit: {
    primaryAccess: 'utility',
    utilityPanel: {
      visible: true,
      defaultCollapsed: false, // Always expanded in print
      preferredWidth: '24rem',
    },
    contextualTab: {
      visible: true,
      overflowPriority: 3, // Higher priority in print
    },
    defaultProfile: 'print',
    statusIndicators: {
      documentHealth: true,
      exportReadiness: true,
      selectionCount: false,
    },
  },
}
```

---

## Component Architecture

### UtilityPanel Component

```typescript
interface UtilityPanelProps {
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  activeTab: 'audit' | 'handoff' | 'history' | 'extensions';
  onTabChange: (tab: string) => void;
  workspace: WorkspaceMode;
  profile: AuditProfileId;
}

function UtilityPanel({ isOpen, onToggle, activeTab, onTabChange, workspace, profile }: UtilityPanelProps) {
  return (
    <aside 
      className={`utility-panel ${isOpen ? 'utility-panel--open' : 'utility-panel--collapsed'}`}
      aria-label="Utility panel"
    >
      <header className="utility-panel__header">
        <h2>Utility</h2>
        <button onClick={() => onToggle(false)} aria-label="Close utility panel">
          <Icon name="X" />
        </button>
      </header>
      
      <nav className="utility-panel__tabs" role="tablist">
        <button 
          role="tab"
          aria-selected={activeTab === 'audit'}
          onClick={() => onTabChange('audit')}
        >
          <Icon name="Lightbulb" />
          Audit
        </button>
        <button 
          role="tab"
          aria-selected={activeTab === 'handoff'}
          onClick={() => onTabChange('handoff')}
        >
          <Icon name="Code" />
          Handoff
        </button>
        {/* Other tabs... */}
      </nav>
      
      <div className="utility-panel__content">
        {activeTab === 'audit' && (
          <AuditPanelContent workspace={workspace} profile={profile} />
        )}
        {activeTab === 'handoff' && (
          <HandoffPanelContent />
        )}
        {/* Other content... */}
      </div>
    </aside>
  );
}
```

### DynamicTabManager Component

```typescript
interface DynamicTabManagerProps {
  workspace: WorkspaceMode;
  state: EditorState;
  tabs: DynamicTabConfig[];
}

function DynamicTabManager({ workspace, state, tabs }: DynamicTabManagerProps) {
  const visibleTabs = tabs.filter(tab => {
    if (tab.workspace && tab.workspace !== workspace) return false;
    if (tab.condition && !tab.condition(state)) return false;
    return tab.visible;
  });
  
  return (
    <div className="inspector-tabs">
      {visibleTabs.map(tab => (
        <InspectorTab key={tab.tabId} tabId={tab.tabId} />
      ))}
    </div>
  );
}
```

---

## Migration Strategy

### Backward Compatibility

**Existing Commands:**
- `openAuditPanel` → Opens utility panel (maintains behavior)
- `setInspectorTab('audit')` → Opens utility panel (maintains behavior)
- All audit commands continue to work

**Existing User Preferences:**
- Audit tab position in tab order preserved (mapped to utility panel tab order)
- Panel width preferences preserved
- Collapse state preserved (mapped to utility panel collapse)

**Graceful Degradation:**
- If utility panel not available, fall back to contextual tab
- If contextual tab not available, fall back to drawer
- If drawer not available, show error message

### Rollout Plan

**Phase 1: Infrastructure (Week 1-2)**
- Add utility panel to workspace configurations
- Implement UtilityPanel component
- Add collapse/expand behavior
- Add keyboard shortcut

**Phase 2: Migration (Week 3-4)**
- Move Audit panel content to utility panel
- Remove Audit tab from inspectorTabs (except design/print)
- Update commands to open utility panel
- Update status badge to open utility panel

**Phase 3: Contextual Tabs (Week 5-6)**
- Implement dynamic tab visibility system
- Add conditional audit tab for drawing/image/motion
- Test tab visibility changes
- Add visual indicators

**Phase 4: Polish (Week 7-8)**
- Add animations
- Add "Back to [Workspace]" button
- Implement workspace switching with context preservation
- Add deep linking support
- Update documentation

### Feature Flags

```typescript
const FEATURE_FLAGS = {
  utilityPanel: true,
  contextualAuditTabs: true,
  dynamicTabVisibility: true,
  auditDeepLinking: true,
  auditWorkspaceSwitching: true,
};
```

---

## Testing Requirements

### Unit Tests
- UtilityPanel component rendering
- Dynamic tab visibility logic
- Workspace configuration parsing
- Profile switching behavior
- Deep link parsing

### Integration Tests
- Status badge opens utility panel
- Commands open utility panel with correct profile
- Contextual tab visibility changes with selection
- Workspace switching preserves audit state
- Deep links navigate to correct state

### E2E Tests
- Open audit from status bar in different workspaces
- Switch workspaces and verify audit panel behavior
- Test contextual tab visibility in drawing/image/motion
- Test deep link navigation
- Test keyboard shortcut (Ctrl+Shift+A)
- Test auto-collapse behavior

### Accessibility Tests
- Keyboard navigation in utility panel
- Screen reader announcements for panel open/close
- Focus management when panel opens/closes
- ARIA labels for dynamic tabs
- High contrast mode support

---

## Performance Considerations

### Panel Rendering
- **Lazy loading:** Audit panel content loads only when panel opens
- **Virtual scrolling:** For large finding lists (1000+ findings)
- **Debounced updates:** Don't re-render on every document change
- **Memoization:** Cache finding lists by profile

### State Management
- **Selective subscription:** Only subscribe to relevant state changes
- **Optimistic updates:** Update UI immediately, validate in background
- **Cache invalidation:** Clear cache when document revision changes
- **Request coalescing:** Coalesce multiple audit requests

### Memory
- **Finding limit:** Cap at 10,000 findings to prevent memory issues
- **Cleanup:** Clear finding cache when panel closes
- **Weak references:** Use weak references for large data structures
- **Garbage collection:** Trigger cleanup on workspace switch

---

## Documentation Updates

### User Documentation
- "Using the Audit Panel" - Updated with utility panel info
- "Audit Profiles" - New section on workspace-specific profiles
- "Keyboard Shortcuts" - Add Ctrl+Shift+A
- "Workspace Guide" - Update audit access per workspace

### Developer Documentation
- "Panel Architecture" - Document utility panel system
- "Dynamic Tabs" - Document conditional tab visibility
- "Audit Configuration" - Document workspace audit config
- "Deep Linking" - Document audit URI scheme

### Migration Guide
- "Migrating to Utility Panel" - Guide for users
- "API Changes" - Document command changes
- "Breaking Changes" - List any breaking changes
- "FAQ" - Common questions about new architecture
