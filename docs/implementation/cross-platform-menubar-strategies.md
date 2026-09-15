# Cross-Platform Menubar and Title-Bar Strategies

**Status**: Implemented (see `cross-platform-menubar-progress.md` for verification) | **Date**: 2026-08-01  
**Purpose**: Define explicit platform-specific strategies for menubar, title-bar, and window controls

## Key Implementation Note

The strategy matrix below is enforced at runtime by `resolveWindowChromeStrategy()` in `@varve/platform` (`windowChrome.ts`). Crucially, **native application menus are macOS-only** (`shouldUseNativeMenu`). On Windows and Linux the in-window custom menubar is the source of truth — installing a native menu there draws a stray OS menubar strip above the webview content (GTK on Linux) with unresolved label keys. This was the confirmed root cause of the CachyOS screenshot defect and is fixed by gating native menus behind the strategy.

---

## Overview

This document defines the platform-specific strategies for menubar, title-bar, and window controls across macOS, Windows, Linux (Wayland/X11), and browser. Each platform has different conventions and capabilities that must be respected for a native-feeling application.

---

## Strategy Types

```typescript
type MenubarStrategy =
  | "native-application-menu"      // macOS system menu bar
  | "custom-window-menubar"        // In-window custom menubar
  | "native-titlebar-custom-menubar" // Native title bar with custom menubar
  | "fully-custom-window-chrome"   // Fully custom title bar + menubar
  | "browser-menubar";             // Browser-only in-page menubar

type DecorationMode =
  | "native"                        // OS-provided decorations
  | "client-side"                   // App-drawn decorations (CSD)
  | "server-side"                   // Window manager decorations (SSD)
  | "custom";                       // Fully custom implementation

type ControlsPosition =
  | "left"                          // macOS-style
  | "right"                         // Windows/Linux-style
  | "native"                        // OS-determined
  | "hidden";                       // No controls (browser/kiosk)
```

---

## Platform Strategy Matrix

| Platform | Display Server | Decoration Mode | Menubar Strategy | Controls Position | Notes |
|----------|---------------|-----------------|------------------|-------------------|-------|
| macOS | N/A | native | native-application-menu | left (traffic lights) | Use system menu bar, custom title bar only if needed |
| Windows | N/A | native | native-titlebar-custom-menubar | right | Native title bar with custom in-window menubar |
| Linux (Wayland) | Wayland | client-side | fully-custom-window-chrome | right (configurable) | CSD required, detect button layout |
| Linux (X11) | X11 | server-side/client-side | fully-custom-window-chrome | right (configurable) | Prefer SSD, fallback to CSD |
| Linux (CachyOS) | Wayland/X11 | client-side | fully-custom-window-chrome | right | Current defect target |
| Browser | N/A | N/A | browser-menubar | hidden | No window controls, in-page menubar only |

---

## macOS Strategy

### Native Application Menu (Preferred)

**Menubar Strategy**: `native-application-menu`

**Rationale**:
- macOS convention: application menu belongs in system menu bar
- Users expect File, Edit, View menus at top of screen
- Native menu bar provides consistent macOS experience
- Traffic light controls (red/yellow/green) are OS-provided

**Implementation**:
```typescript
if (platform.os === 'mac' && platform.capabilities.has('nativeMenu')) {
  return {
    menubarStrategy: 'native-application-menu',
    decorationMode: 'native',
    controlsPosition: 'native',
    showCustomTitleBar: false,
    showCustomMenubar: false,
  };
}
```

**Window Configuration**:
- `decorations: true` in `tauri.conf.json`
- No custom `TitleBar` component
- Menubar rendered via Tauri native menu API
- In-window UI starts directly at content

**Fallback**:
- If native menu unavailable, use `custom-window-menubar`
- Keep traffic light area clear of custom UI

**Special Cases**:
- Fullscreen: macOS handles menu bar visibility automatically
- Multiple windows: Native menu targets active window
- Locale changes: Rebuild native menu after locale switch

---

## Windows Strategy

### Native Title Bar with Custom Menubar

**Menubar Strategy**: `native-titlebar-custom-menubar`

**Rationale**:
- Windows convention: title bar and controls are OS-provided
- Application menu typically in-window (ribbon, menubar, or toolbar)
- Native window controls provide correct hover/pressed behavior
- Snap Layouts integration requires native title bar

**Implementation**:
```typescript
if (platform.os === 'windows') {
  return {
    menubarStrategy: 'native-titlebar-custom-menubar',
    decorationMode: 'native',
    controlsPosition: 'right',
    showCustomTitleBar: false,
    showCustomMenubar: true,
    menubarPlacement: 'below-titlebar',
  };
}
```

**Window Configuration**:
- `decorations: true` in `tauri.conf.json`
- No custom `TitleBar` component
- Custom menubar mounted below native title bar
- Window controls (minimize/maximize/close) are OS-provided

**Layout**:
```
┌─────────────────────────────────────────────┐
│ Varve - [Document] □ □ ×    (native)      │
├─────────────────────────────────────────────┤
│ File | Edit | View | Object | Help          │ (custom)
├─────────────────────────────────────────────┤
│                                             │
│              Canvas Content                 │
│                                             │
└─────────────────────────────────────────────┘
```

**Special Cases**:
- Maximized: Title bar height adjusts automatically
- Snap Layouts: Native integration preserved
- High DPI: OS handles scaling
- RTL: Native controls mirror automatically

---

## Linux Strategy

### Fully Custom Window Chrome

**Menubar Strategy**: `fully-custom-window-chrome`

**Rationale**:
- Linux fragmentation: no single convention across DEs
- Wayland requires client-side decorations (CSD)
- X11 supports both server-side (SSD) and client-side
- Window manager button layouts vary (left/right)
- Must detect environment and adapt

**Display Server Detection**:
```typescript
type DisplayServer = 'wayland' | 'x11' | 'unknown';

function detectDisplayServer(): DisplayServer {
  if (typeof window === 'undefined') return 'unknown';
  
  // Wayland detection
  if (typeof (window as any).gtk !== 'undefined') {
    // WebKitGTK Wayland check
    const backend = (window as any).gtk?.backend;
    if (backend === 'wayland') return 'wayland';
  }
  
  // X11 detection
  if (typeof (window as any).gtk !== 'undefined') {
    const backend = (window as any).gtk?.backend;
    if (backend === 'x11') return 'wayland';
  }
  
  // Fallback: check environment variables (if accessible)
  // This may not be available in webview sandbox
  
  return 'unknown';
}
```

**Window Manager Detection**:
```typescript
type WindowManager = 'gnome' | 'kde' | 'xfce' | 'other' | 'unknown';

function detectWindowManager(): WindowManager {
  // This requires Tauri side-channel or environment detection
  // For now, default to 'unknown' and use conservative defaults
  return 'unknown';
}
```

**Button Layout Detection**:
```typescript
type ButtonLayout = 'left' | 'right';

function detectButtonLayout(): ButtonLayout {
  // GNOME/Mutter: right (usually)
  // KDE/KWin: configurable (default right)
  // XFCE: right (usually)
  // Default to right for safety
  return 'right';
}
```

**Implementation**:
```typescript
if (platform.os === 'linux') {
  const displayServer = detectDisplayServer();
  const buttonLayout = detectButtonLayout();
  
  return {
    menubarStrategy: 'fully-custom-window-chrome',
    decorationMode: displayServer === 'wayland' ? 'client-side' : 'server-side',
    controlsPosition: buttonLayout,
    showCustomTitleBar: true,
    showCustomMenubar: true,
    displayServer,
    buttonLayout,
  };
}
```

**Window Configuration**:
- `decorations: false` in `tauri.conf.json` (for CSD)
- Custom `TitleBar` component with drag region
- Custom window controls (minimize/maximize/close)
- Custom menubar integrated with title bar

**Layout (Right Controls)**:
```
┌─────────────────────────────────────────────┐
│ Varve  File|Edit|View|Object|Help  □ □ ×  │
├─────────────────────────────────────────────┤
│                                             │
│              Canvas Content                 │
│                                             │
└─────────────────────────────────────────────┘
```

**Layout (Left Controls)**:
```
┌─────────────────────────────────────────────┐
│ × □ □  File|Edit|View|Object|Help  Varve   │
├─────────────────────────────────────────────┤
│                                             │
│              Canvas Content                 │
│                                             │
└─────────────────────────────────────────────┘
```

**CachyOS-Specific Fixes**:
- [x] Ensure menubar does not render above window controls (native menu gated to macOS; GTK strip removed)
- [x] Resolve raw localization keys (full dictionary + safe fallback; integrity-tested)
- [x] Ensure drag region does not overlap interactive elements (controls live outside `data-tauri-drag-region`)
- [x] Window-control placement + maximize/restore state via live window events (`useWindowChrome`)
- [ ] Capture before/after desktop screenshots on CachyOS Wayland/X11 (manual desktop-build step)

**Wayland-Specific Considerations**:
- CSD is mandatory (no SSD support)
- Shadow and rounded corners handled by compositor
- Global menu not available (must be in-window)
- Drag region must be explicitly marked

**X11-Specific Considerations**:
- Prefer SSD when available (native decorations)
- Fallback to CSD if SSD negotiation fails
- Window manager may override button placement
- Test with multiple DEs (GNOME, KDE, XFCE)

---

## Browser Strategy

### Browser-Only Menubar

**Menubar Strategy**: `browser-menubar`

**Rationale**:
- Browser has no window controls to manage
- No native menu integration possible
- Application runs in tab, not as separate window
- Menubar is purely in-page UI

**Implementation**:
```typescript
if (platform.kind === 'web') {
  return {
    menubarStrategy: 'browser-menubar',
    decorationMode: 'native',
    controlsPosition: 'hidden',
    showCustomTitleBar: false,
    showCustomMenubar: true,
    menubarPlacement: 'top-of-page',
  };
}
```

**Window Configuration**:
- No Tauri window configuration (browser-only)
- No custom `TitleBar` component
- Custom menubar at top of page
- No window controls (browser provides tab controls)

**Layout**:
```
┌─────────────────────────────────────────────┐
│ File | Edit | View | Object | Help          │
├─────────────────────────────────────────────┤
│                                             │
│              Canvas Content                 │
│                                             │
└─────────────────────────────────────────────┘
```

**Special Cases**:
- Browser fullscreen: Menubar may need to auto-hide
- Mobile browsers: Menubar may need responsive adaptation
- Keyboard shortcuts: Avoid browser shortcut conflicts

---

## Strategy Resolver

### Central Resolution Function

```typescript
interface WindowChromeStrategy {
  menubarStrategy: MenubarStrategy;
  decorationMode: DecorationMode;
  controlsPosition: ControlsPosition;
  showCustomTitleBar: boolean;
  showCustomMenubar: boolean;
  menubarPlacement?: 'below-titlebar' | 'integrated' | 'top-of-page';
  displayServer?: DisplayServer;
  buttonLayout?: ButtonLayout;
}

function resolveWindowChromeStrategy(
  platform: PlatformInfo,
  preferences?: Partial<WindowChromeStrategy>
): WindowChromeStrategy {
  const baseStrategy = getBaseStrategy(platform);
  return { ...baseStrategy, ...preferences };
}

function getBaseStrategy(platform: PlatformInfo): WindowChromeStrategy {
  switch (platform.os) {
    case 'mac':
      return getMacOSStrategy(platform);
    case 'windows':
      return getWindowsStrategy(platform);
    case 'linux':
      return getLinuxStrategy(platform);
    default:
      return getFallbackStrategy(platform);
  }
}
```

### Capability-Based Overrides

```typescript
function getMacOSStrategy(platform: PlatformInfo): WindowChromeStrategy {
  // If native menu capability is available, use it
  if (platform.capabilities.has('nativeMenu')) {
    return {
      menubarStrategy: 'native-application-menu',
      decorationMode: 'native',
      controlsPosition: 'native',
      showCustomTitleBar: false,
      showCustomMenubar: false,
    };
  }
  
  // Fallback to custom menubar
  return {
    menubarStrategy: 'custom-window-menubar',
    decorationMode: 'native',
    controlsPosition: 'native',
    showCustomTitleBar: false,
    showCustomMenubar: true,
    menubarPlacement: 'below-titlebar',
  };
}

function getWindowsStrategy(platform: PlatformInfo): WindowChromeStrategy {
  return {
    menubarStrategy: 'native-titlebar-custom-menubar',
    decorationMode: 'native',
    controlsPosition: 'right',
    showCustomTitleBar: false,
    showCustomMenubar: true,
    menubarPlacement: 'below-titlebar',
  };
}

function getLinuxStrategy(platform: PlatformInfo): WindowChromeStrategy {
  const displayServer = detectDisplayServer();
  const buttonLayout = detectButtonLayout();
  
  return {
    menubarStrategy: 'fully-custom-window-chrome',
    decorationMode: displayServer === 'wayland' ? 'client-side' : 'server-side',
    controlsPosition: buttonLayout,
    showCustomTitleBar: true,
    showCustomMenubar: true,
    displayServer,
    buttonLayout,
  };
}

function getFallbackStrategy(platform: PlatformInfo): WindowChromeStrategy {
  // Conservative fallback for unknown platforms
  if (platform.kind === 'web') {
    return {
      menubarStrategy: 'browser-menubar',
      decorationMode: 'native',
      controlsPosition: 'hidden',
      showCustomTitleBar: false,
      showCustomMenubar: true,
      menubarPlacement: 'top-of-page',
    };
  }
  
  // Default to fully custom for unknown desktop platforms
  return {
    menubarStrategy: 'fully-custom-window-chrome',
    decorationMode: 'custom',
    controlsPosition: 'right',
    showCustomTitleBar: true,
    showCustomMenubar: true,
  };
}
```

---

## State Transitions

### Window State Changes

```typescript
interface WindowChromeState {
  strategy: WindowChromeStrategy;
  isFocused: boolean;
  isMaximized: boolean;
  isFullscreen: boolean;
  isResizable: boolean;
  scaleFactor: number;
}

function updateChromeState(
  currentState: WindowChromeState,
  event: WindowEvent
): WindowChromeState {
  switch (event.type) {
    case 'focus':
      return { ...currentState, isFocused: event.focused };
    case 'maximize':
      return { ...currentState, isMaximized: event.maximized };
    case 'fullscreen':
      return { ...currentState, isFullscreen: event.fullscreen };
    case 'scale':
      return { ...currentState, scaleFactor: event.scaleFactor };
    default:
      return currentState;
  }
}
```

### Fullscreen Behavior

| Platform | Fullscreen Type | Menubar Behavior | Title Bar Behavior |
|----------|----------------|------------------|-------------------|
| macOS | Native | Auto-hidden by OS | Hidden by OS |
| Windows | Borderless | Auto-hide or overlay | Hidden or overlay |
| Linux (Wayland) | Borderless | Auto-hide or overlay | Hidden or overlay |
| Linux (X11) | Borderless | Auto-hide or overlay | Hidden or overlay |
| Browser | API | Auto-hide or overlay | N/A |

---

## Implementation Priority

### Phase 1: Foundation (High Priority)
1. Implement strategy resolver
2. Add display server detection for Linux
3. Create window chrome state model
4. Update Tauri configuration per platform

### Phase 2: macOS (Medium Priority)
1. Implement native application menu
2. Remove custom title bar on macOS
3. Test traffic light integration
4. Handle fullscreen transitions

### Phase 3: Windows (Medium Priority)
1. Enable native decorations
2. Remove custom title bar
3. Implement custom menubar below title bar
4. Test Snap Layouts integration

### Phase 4: Linux (High Priority - CachyOS Fix)
1. Implement display server detection
2. Fix custom title bar layout
3. Resolve menubar/control conflicts
4. Test on Wayland and X11
5. Add button layout detection

### Phase 5: Browser (Low Priority)
1. Ensure no window controls render
2. Verify menubar placement
3. Test responsive behavior

---

## Testing Strategy

### Platform-Specific Testing
- **macOS**: Test native menu, traffic lights, fullscreen
- **Windows**: Test native title bar, Snap Layouts, DPI scaling
- **Linux**: Test Wayland CSD, X11 SSD, multiple DEs
- **Browser**: Test menubar only, no window controls

### Environment Matrix
| Platform | Environment | Test Coverage |
|----------|-------------|---------------|
| macOS | macOS 13+ | Full |
| Windows | Windows 10/11 | Full |
| Linux | Ubuntu (GNOME/Wayland) | Full |
| Linux | Ubuntu (GNOME/X11) | Full |
| Linux | KDE Plasma (Wayland) | Full |
| Linux | KDE Plasma (X11) | Full |
| Linux | CachyOS (Wayland) | Full |
| Linux | CachyOS (X11) | Full |
| Browser | Chrome | Full |
| Browser | Firefox | Full |
| Browser | Safari | Full |

---

## Migration Path

### Current State → Target State

1. **Current**: Fully custom on all platforms
2. **Target**: Platform-appropriate strategies

### Migration Steps
1. Implement strategy resolver (no behavior change)
2. Add capability detection (no behavior change)
3. Enable platform-specific strategies (behavior change)
4. Test each platform independently
5. Roll back if issues detected

### Rollback Strategy
- Feature flags for each platform strategy
- Ability to force custom chrome globally
- Per-user preference override

---

## References

### Platform Conventions
- [macOS Human Interface Guidelines - Menu Bar](https://developer.apple.com/design/human-interface-guidelines/menus)
- [Windows Design Guidelines - Title Bars](https://learn.microsoft.com/en-us/windows/apps/design/layout/title-bar)
- [GNOME Human Interface Guidelines - Header Bars](https://developer.gnome.org/hig/patterns/headers/header-bars.html)
- [KDE Human Interface Guidelines - Window Decoration](https://develop.kde.org/hig/)

### Technical References
- [Tauri 2 Window Customization](https://tauri.app/learn/window-customization/)
- [Wayland Client-Side Decorations](https://wayland.freedesktop.org/)
- [W3C ARIA Authoring Practices - Menubar](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/)

---

## Appendix: Configuration Examples

### macOS Tauri Configuration
```json
{
  "app": {
    "windows": [{
      "decorations": true,
      "hiddenTitle": true,
      "titleBarStyle": "default"
    }]
  }
}
```

### Windows Tauri Configuration
```json
{
  "app": {
    "windows": [{
      "decorations": true,
      "titleBarStyle": "default"
    }]
  }
}
```

### Linux (Wayland) Tauri Configuration
```json
{
  "app": {
    "windows": [{
      "decorations": false,
      "transparent": false
    }]
  }
}
```

### Browser Configuration
No Tauri configuration needed.

---

**Next Steps**: Proceed to Phase 4 - Build canonical window-chrome state model and strategy resolver.
