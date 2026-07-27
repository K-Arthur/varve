# Tooltip Contributor Guide

This guide provides practical patterns and best practices for using the Strata tooltip system effectively.

## Quick Start

### Basic Tooltip
```tsx
import { Tooltip } from '@strata/ui';

<Tooltip label="Save your document">
  <button>Save</button>
</Tooltip>
```

### Tooltip with Shortcut
```tsx
import { Tooltip } from '@strata/ui';
import { toolShortcutLabel } from '@strata/editor';

<Tooltip label="Save" shortcut={toolShortcutLabel('save')}>
  <button>Save</button>
</Tooltip>
```

### Disabled Control with Explanation
```tsx
import { Tooltip } from '@strata/ui';

<Tooltip label="Boolean operation" disabledReason="Select 2+ shapes for boolean">
  <button disabled>Boolean</button>
</Tooltip>
```

## Common Patterns

### 1. Icon-Only Buttons
Icon-only buttons **must** have tooltips for accessibility:

```tsx
// ✅ Good
<Tooltip label="Zoom in">
  <Icon name="ZoomIn" />
</Tooltip>

// ❌ Bad - no accessible name
<Icon name="ZoomIn" />
```

### 2. Truncated Text
Use `truncationOnly` to only show tooltip when text is actually truncated:

```tsx
// ✅ Good - only shows when needed
<Tooltip label={veryLongFileName} truncationOnly>
  <span className="filename">{veryLongFileName}</span>
</Tooltip>

// ❌ Bad - always shows tooltip even when not needed
<Tooltip label={shortFileName}>
  <span className="filename">{shortFileName}</span>
</Tooltip>
```

### 3. Disabled Controls
When a control is disabled, explain why using `disabledReason`:

```tsx
// ✅ Good - explains why disabled
<Tooltip label="Export" disabledReason="No pages to export">
  <button disabled>Export</button>
</Tooltip>

// ❌ Bad - no explanation
<button disabled title="Export">Export</button>
```

### 4. Status Indicators
For non-interactive indicators, use ARIA attributes instead of tooltips:

```tsx
// ✅ Good - accessible without tooltip
<span role="img" aria-label="Has animation" className="motion-dot" />

// ❌ Bad - tooltip not keyboard accessible
<span title="Has animation" className="motion-dot" />
```

### 5. Keyboard Shortcuts
Always source shortcuts from the registry, never hard-code:

```tsx
// ✅ Good - centralized and consistent
<Tooltip label="Undo" shortcut={toolShortcutLabel('undo')}>
  <button>Undo</button>
</Tooltip>

// ❌ Bad - hard-coded and inconsistent
<button title="Undo (Ctrl+Z)">Undo</button>
```

## Accessibility Requirements

### Accessible Names
Every tooltip trigger **must** have an accessible name:

```tsx
// ✅ Good - has visible text
<Tooltip label="Additional info">
  <button>Save</button>
</Tooltip>

// ✅ Good - has aria-label
<Tooltip label="Additional info">
  <button aria-label="Save document">
    <Icon name="Save" />
  </button>
</Tooltip>

// ❌ Bad - no accessible name
<Tooltip label="Additional info">
  <button>
    <Icon name="Save" />
  </button>
</Tooltip>
```

### Keyboard Navigation
Test that tooltips work with keyboard:

- **Tab**: Focus should move to the trigger
- **Enter/Space**: Should activate the control
- **Tooltip should appear**: On focus, not just hover
- **Escape**: Should dismiss the tooltip

### Screen Reader Testing
Test with screen readers (NVDA, JAWS, VoiceOver):

- **Announcement**: Trigger should announce its purpose
- **Tooltip content**: Should be announced when tooltip appears
- **No redundancy**: Avoid announcing the same info twice

## When NOT to Use Tooltips

### Redundant Information
```tsx
// ❌ Bad - tooltip repeats visible text
<Tooltip label="Save">
  <button>Save</button>
</Tooltip>
```

### Decorative Elements
```tsx
// ❌ Bad - decorative icon doesn't need tooltip
<Tooltip label="Decoration">
  <div className="decoration" />
</Tooltip>
```

### Very Long Descriptions
```tsx
// ❌ Bad - tooltip is too long, should use modal or help panel
<Tooltip label="This is a very long explanation that should be in documentation instead...">
  <button>Help</button>
</Tooltip>
```

### Critical Information
```tsx
// ❌ Bad - critical info shouldn't be hidden in tooltip
<Tooltip label="This action cannot be undone">
  <button>Delete</button>
</Tooltip>

// ✅ Good - use confirmation dialog instead
<button onClick={() => confirmDelete()}>Delete</button>
```

## Advanced Usage

### Controlled Mode
For custom tooltip behavior:

```tsx
const [open, setOpen] = useState(false);

<Tooltip 
  label="Custom tooltip" 
  open={open} 
  onOpenChange={setOpen}
>
  <button>Custom</button>
</Tooltip>
```

### Custom Delays
Adjust timing for specific use cases:

```tsx
// Fast appearance for frequently used controls
<Tooltip label="Quick action" delay={100}>
  <button>Quick</button>
</Tooltip>

// Slow appearance to avoid annoyance
<Tooltip label="Rare action" delay={500}>
  <button>Rare</button>
</Tooltip>
```

### Custom Positioning
Control tooltip placement:

```tsx
<Tooltip label="Positioned tooltip" placement="right">
  <button>Right</button>
</Tooltip>
```

### TooltipProvider
For context management in complex components:

```tsx
import { TooltipProvider } from '@strata/ui';

<TooltipProvider>
  <YourComponent />
</TooltipProvider>
```

## Migration from Native Title

### Simple Migration
```tsx
// Before
<button title="Click to save">Save</button>

// After
<Tooltip label="Click to save">
  <button>Save</button>
</Tooltip>
```

### Migration with Shortcut
```tsx
// Before
<button title="Save (Ctrl+S)">Save</button>

// After
<Tooltip label="Save" shortcut={toolShortcutLabel('save')}>
  <button>Save</button>
</Tooltip>
```

### Migration to Status Indicator
```tsx
// Before
<span title="Has animation" className="dot" />

// After
<span role="img" aria-label="Has animation" className="dot" />
```

## Performance Considerations

### Efficient Content
Keep tooltip content simple and fast to render:

```tsx
// ✅ Good - simple string
<Tooltip label="Save">Save</Tooltip>

// ❌ Bad - expensive computation
<Tooltip label={expensiveComputation()}>Save</Tooltip>
```

### Avoid Re-renders
Memoize complex tooltip content:

```tsx
const tooltipContent = useMemo(() => (
  <div>{complexContent}</div>
), [dependencies]);

<Tooltip label={tooltipContent}>Trigger</Tooltip>
```

### Use truncationOnly
For text that might not need tooltips:

```tsx
<Tooltip label={longText} truncationOnly>
  <span className="truncate">{longText}</span>
</Tooltip>
```

## Testing

### Unit Tests
Test tooltip behavior:

```tsx
it('shows tooltip on hover', () => {
  render(
    <Tooltip label="Test">
      <button>Trigger</button>
    </Tooltip>
  );
  const trigger = screen.getByRole('button');
  fireEvent.mouseEnter(trigger);
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
});
```

### Accessibility Tests
Test keyboard navigation:

```tsx
it('shows tooltip on focus', () => {
  render(
    <Tooltip label="Test">
      <button>Trigger</button>
    </Tooltip>
  );
  const trigger = screen.getByRole('button');
  trigger.focus();
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
});
```

### E2E Tests
Test in real browser context:

```tsx
test('tooltip interaction', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Save' });
  await button.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
});
```

## Troubleshooting

### Tooltip Not Showing
- Check that trigger has an accessible name
- Verify pointer events are not blocked
- Ensure z-index allows tooltip to be visible
- Check browser console for React warnings

### Wrong Position
- Check for conflicting CSS positioning
- Verify parent container has `overflow: visible`
- Consider using `placement` prop to override default

### Accessibility Issues
- Test with keyboard navigation
- Check screen reader announcements
- Verify ARIA attributes are correct
- Ensure no duplicate information

### Performance Problems
- Profile render performance
- Check for expensive computations in tooltip content
- Use `truncationOnly` when appropriate
- Consider debouncing rapidly updating content

## Resources

### Internal Documentation
- [Tooltip System Audit](../audits/tooltip-system-audit-2026-07-27.md)
- [Component Source](../../../packages/ui/src/components/Tooltip.tsx)
- [Tooltip Tests](../../../packages/ui/src/components/Tooltip.test.tsx)

### External References
- [ARIA Authoring Practices Guide - Tooltip](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
- [WCAG 2.2 Success Criteria](https://www.w3.org/WAI/WCAG22/quickref/)
- [React Accessibility Documentation](https://react.dev/learn/accessibility)

### Shortcut System
- [Shortcut Registry](../../../packages/editor/src/shortcuts/)
- [toolShortcutLabel Utility](../../../packages/editor/src/shortcuts/toolShortcutLabel.ts)

## Getting Help

If you encounter issues with tooltips:
1. Check this guide for common patterns
2. Review the audit document for known issues
3. Test accessibility requirements
4. Check existing implementations for reference
5. Consult the ARIA APG for standard patterns