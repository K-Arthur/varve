# Touch Multi-Select Mode

## Mode State

`EditorState.touchMultiSelect: { active: boolean, suspended: boolean }`

- `active`: mode is enabled
- `suspended`: temporarily suspended during transform gestures

## Lifecycle

| Event | Behaviour |
|-------|-----------|
| Toggle button | Toggles `active` |
| Tool switch | Mode preserved |
| Document switch | Mode preserved |
| Escape | Mode preserved, selection cleared |
| Transform drag | Mode suspended during drag |

## Interaction

When `touchMultiSelect.active` is true, `SelectTool` changes its tap behavior:

- **Tap unselected node**: add to selection
- **Tap selected node**: remove from selection  
- **Tap empty canvas**: preserve selection (no marquee)
- **Long press**: deep selection menu (unchanged)
- **Drag**: move selection (unchanged)
- **Two-finger pinch/pan**: viewport control (unchanged)

## Frontend

A toggle button in the FloatingToolbar (`data-testid="touch-multiselect-toggle"`)
shows a finger-tap SVG icon. The active state uses accent color and the
`aria-pressed` attribute reflects state for accessibility.

## Accessibility

- `aria-pressed` on toggle reflects mode state
- `aria-label` changes contextually ("Enable/Disable touch multi-select")
- Not colour-only: text label and tooltip explain behaviour
- Screen readers: selection changes are announced via `announceSelection`
