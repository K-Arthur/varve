# Comic Lettering Features Audit (Varve 0.5.0)

## Summary

Audited Varve 0.5.0 codebase to determine which comic lettering features exist and how they're exposed in the UI.

## Findings

### 1. Balloon Types (CalloutRecipe)

**Defined in codebase** (`packages/scene/src/types.ts:1849`):
```typescript
kind: 'speech' | 'thought' | 'caption' | 'whisper' | 'shout' | 'burst' | 'cloud';
```

All 7 balloon types exist in the scene model.

### 2. UI Exposure

#### Inspector Section (`packages/editor/src/components/Inspector/sections/CalloutSection.tsx`)

The `CalloutSection` shows all 7 balloon types in a dropdown, **BUT** it only appears AFTER a balloon is already selected. It allows changing the balloon kind and adjusting parameters.

Available operations:
- Change balloon kind (speech → thought → caption → etc.)
- Adjust padding
- Change fit policy (reflow, fit-balloon, overflow)
- Change wrap shape (ellipse vs rectangle)
- Add/remove tails
- Flip tail direction
- Adjust tail curve and width
- Detach recipe

#### Typography Section (`packages/editor/src/components/Inspector/sections/TypographySection.tsx:753`)

Only exposes:
```jsx
<Button onClick={createBalloon}>
  Add speech balloon
</Button>
```

**This only creates speech balloons.** No UI to create thought/caption/shout/burst/cloud/whisper balloons directly.

### 3. Command Palette / Quick Actions

**Quick Actions Bar** exists and opens with `Ctrl+Shift+:` (not `Ctrl+K` or `Ctrl+Shift+P`).

Located in: `packages/editor/src/components/QuickActionsBar/QuickActionsBar.tsx`

Shortcut defined in: `packages/editor/src/shortcuts/ShortcutManager.ts:481`

```typescript
quickActions: {
  // Shift+; emits ':' as KeyboardEvent.key on standard layouts.
  binding: { key: ':', ctrl: true, shift: true },
  label: 'Quick Actions',
  category: 'View',
}
```

### 4. Panel Layout Tools

**No dedicated panel layout tool found** in the 0.5.0 codebase. Comic page layouts are done with:
- Frames (general frames, not comic-specific)
- Guides
- Grids

## Implications for Marketing

Current 0.5.0 capabilities:
- ✓ Speech balloons (via Inspector button)
- ✓ All 7 balloon types (via Inspector dropdown after selection)
- ✓ Quick Actions bar exists (Ctrl+Shift+:)
- ✗ No direct "Add thought balloon" button
- ✗ No panel layout tool
- ✗ Ctrl+K / Ctrl+Shift+P don't open anything

## Recommendations

Marketing materials should say:
- "Create speech balloons and change them to thought, shout, caption, burst, cloud, or whisper styles"
- "Quick actions (Ctrl+Shift+:)"
- Avoid claiming "panel layout tools" unless we mean general frames/guides

## Files Referenced

- `packages/scene/src/types.ts` (CalloutRecipe type)
- `packages/scene/src/callout.ts` (callout operations)
- `packages/editor/src/components/Inspector/sections/CalloutSection.tsx` (UI)
- `packages/editor/src/components/Inspector/sections/TypographySection.tsx` (creation)
- `packages/editor/src/shortcuts/ShortcutManager.ts` (key bindings)
