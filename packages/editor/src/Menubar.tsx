/**
 * Menubar — APG menubar pattern (Strata plan §5.2).
 *
 * Renders static menu triggers. Submenus and the full APG menubar pattern
 * (with menuitems and Arrow/Home/End navigation) arrive in task 0.9 polish.
 * For the first pass: a simple bar with click-to-open stubs.
 */

const LABELS = ['File', 'Edit', 'View', 'Object', 'Arrange', 'Plugins', 'Help'];

export function Menubar() {
  return (
    <div className="editor-menubar" role="menubar" aria-label="Application">
      {LABELS.map((l) => (
        <button
          key={l}
          role="menuitem"
          className="editor-menubar__item"
          aria-haspopup="true"
          tabIndex={-1}
          type="button"
        >
          {l}
        </button>
      ))}
    </div>
  );
}
