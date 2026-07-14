## Design Context

### Users
Designers and creatives using Strata (local-first design suite) on desktop (Tauri/CachyOS primary) and browser. They expect calm, native, professional feedback — not dashboard theater.

### Brand Personality
Restrained, precise, premium. Teal accent (#39d0c6) with sandstone/terracotta secondary brand marks.

### Aesthetic Direction
- Startup: **brand-fixed dark** (`#10151f` + white symbolic logo), thin spectral fringe, quiet ambient pulse. Does not follow light/dark/HC app themes (intentional Cursor-style identity moment).
- Anti-references: RGB glitch jitter, reflection sweeps, VHS noise, purple AI gradients, theme-reactive splash.
- Loading UI communicates unavoidable latency only.

### Design Principles
1. Smallest justified loading surface; no decoration for decoration's sake.
2. Static or near-zero motion preferred over looping spectacle (perf + a11y).
3. True viewport centering — never pin chrome to the top by accident.
4. Offline-first: startup assets must ship bundled, never remote-fetched at first paint.
5. Tokens for app chrome; startup splash is an exception — fixed brand canvas.
