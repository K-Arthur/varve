# Website Strategy — Phase C

> **Note:** This document predates the project's licensing decisions and
> describes the project as AGPL-3.0-or-later. See `LICENSE` for the current
> license (FSL-1.1-MIT).

**Date:** 2026-07-08  
**Purpose:** Evidence-based website strategy for Strata's public product presence, grounded in Phase A (Product Truth Matrix) and Phase B (Research Findings).

---

## Executive Summary

Strata's website should position it as a **serious, technically sophisticated design application** built by a solo developer, with honest communication about both strengths and current limitations. The strategy draws from DaVinci Resolve's depth and authority, Figma's clarity and modern organization, Sketch's independent identity, and open-source tools' community ownership—while being truthful about Strata's actual capabilities (from Product Truth Matrix) and AGPL licensing.

**Core Positioning:** Local-first, cross-platform design suite with native Rust performance, built independently for designers who value technical depth and honest development.

---

## 1. Audience Analysis

### 1.1 Primary Audiences

**A. Independent Designers & Freelancers**
- **Characteristics:** Value performance, offline workflows, no cloud lock-in, cross-platform flexibility
- **Jobs-to-be-done:** Design UI layouts, create vector graphics, prototype interactions, export to code
- **Why Strata:** Local-first, no subscription, native performance, cross-platform (Linux/macOS/Windows), code export
- **Concerns:** Is it mature enough? Will it be maintained? Can I trust a solo project?
- **Messaging needs:** Technical credibility, stability proof, honest roadmap, clear support path

**B. Linux Designers & Developers**
- **Characteristics:** Specifically need Linux support (CachyOS, Arch, Ubuntu, Fedora), value open-source ethos, technical sophistication
- **Jobs-to-be-done:** Design on Linux, export code, integrate with development workflows
- **Why Strata:** Native Linux support (AppImage/deb/rpm/AUR), Rust engine, code export, AGPL alignment with open-source values
- **Concerns:** Is Linux first-class or afterthought? Will it stay maintained? Package quality?
- **Messaging needs:** Linux-first commitment, package quality (AUR, AppImage), dependencies clear, performance benchmarks

**C. Privacy-Conscious Designers**
- **Characteristics:** Avoid cloud-based tools, want local data control, concerned about surveillance capitalism
- **Jobs-to-be-done:** Design without cloud lock-in, keep data local, no account requirements
- **Why Strata:** Local-first architecture, no cloud sync (by design), optional collaboration (future), AGPL transparency
- **Concerns:** Is it truly local? Will it add cloud later? What data does it collect?
- **Messaging needs:** Local-first commitment, privacy policy clarity, no telemetry (if true), data control

**D. Technical Designers & Developers**
- **Characteristics:** Value technical architecture, performance, code quality, extensibility
- **Jobs-to-be-done:** Understand how it works, extend it, integrate with dev workflows, export clean code
- **Why Strata:** Rust engine, IR-replay architecture, TypeScript facade, code export, AGPL source availability
- **Concerns:** Is the architecture sound? Can I extend it? Is the code quality good?
- **Messaging needs:** Technical depth (IR-replay, 86fps), architecture docs, contribution guide, source access

### 1.2 Secondary Audiences

**E. Open-Source Enthusiasts**
- **Characteristics:** Value free software, community ownership, transparency, copyleft
- **Jobs-to-be-done:** Support AGPL projects, contribute to open-source tools
- **Why Strata:** AGPL-3.0-or-later, solo-developer transparency, community contribution opportunities
- **Concerns:** Is it truly open-source? What does AGPL mean for my use? Can I contribute?
- **Messaging needs:** AGPL explanation, contribution paths, community ownership, transparency

**F. Students & Learners**
- **Characteristics:** Learning design tools, budget-conscious, want to understand professional workflows
- **Jobs-to-be-done:** Learn design software, build portfolio, transition to professional tools
- **Why Strata:** Free (AGPL), no subscription, professional features (motion, code export), learning resources
- **Concerns:** Is it good for learning? Are there tutorials? Will skills transfer?
- **Messaging needs:** Learning resources, tutorial links, feature comparison with industry tools, skill transferability

**G. Switchers from Commercial Tools**
- **Characteristics:** Frustrated with subscriptions, cloud lock-in, or tool bloat in Figma/Adobe
- **Jobs-to-be-done:** Find alternative that meets core needs without downsides
- **Why Strata:** No subscription, local-first, code export, professional features
- **Concerns:** Can it replace my current tool? What will I miss? Migration pain?
- **Messaging needs:** Feature comparison, migration guides, honest limitations, roadmap for missing features

---

## 2. Positioning Statement

### 2.1 Core Positioning

**Strata is a local-first, cross-platform design suite built by a solo developer, combining native Rust performance with honest development and AGPL transparency.**

**Key Differentiators:**
1. **Local-first by design:** No cloud lock-in, no account required, data stays on your machine
2. **Cross-platform native performance:** Linux (CachyOS/Arch/Ubuntu/Fedora), macOS Universal, Windows — all with native Rust engine
3. **Technical depth:** IR-replay rendering (86fps canvas2D), comprehensive tooling (vector, typography, motion, effects, code export)
4. **Honest development:** Solo-developer transparency, clear roadmap, AGPL licensing, community contribution welcome
5. **No subscription:** One-time download, own your tools forever

### 2.2 Supporting Messaging

**Against Cloud Tools:**
- "Your designs belong on your machine, not in our cloud"
- "No account required. No subscription. No lock-in."
- "Design offline, collaborate when you choose"

**Against Bloat:**
- "Built for designers, not for PMs, developers, or enterprise committees" (Sketch-inspired)
- "Focused tools, no feature creep"
- "Performance-first architecture: Rust engine, IR-replay rendering"

**For Technical Credibility:**
- "Native Rust engine on desktop, WASM on web — same facade, zero compromise"
- "86fps canvas2D replay via IR-replay architecture"
- "Cross-platform: Linux, macOS, Windows — first-class support on all three"

**For Solo-Developer Honesty:**
- "Built independently by one designer-developer"
- "Transparent development: public roadmap, honest limitations, community input"
- "AGPL-3.0-or-later: source available, copyleft, community-owned"

### 2.3 What NOT to Claim

Based on Product Truth Matrix, do NOT claim:
- ❌ "AI-powered" (background removal uses AI models, but don't overstate)
- ❌ "Real-time collaboration" (UI scaffolding only, no transport)
- ❌ "Advanced typography" (rich text/variable fonts are types-only, not rendered)
- ❌ "Professional print production" (Phase 1-4 implemented, Phase 5-6 deferred)
- ❌ "ARM support" (only x86_64 Linux, Universal macOS, x86_64 Windows)
- ❌ "Code-signed" or "Verified" (not implemented)
- ❌ "Open source" without qualifying AGPL copyleft

---

## 3. Information Architecture

### 3.1 Site Structure

```
/ (Homepage)
├── /product (Product Overview)
├── /features (Feature Chapters - deep dives)
│   ├── /canvas (Canvas & Rendering)
│   ├── /vector-tools (Vector Design Tools)
│   ├── /typography (Typography System)
│   ├── /color-effects (Color & Effects)
│   ├── /motion (Motion & Prototyping)
│   ├── /export (Export & Code Generation)
│   └── /components (Components & Design Systems)
├── /download (Download)
├── /releases (Release Notes)
├── /docs (Documentation)
│   ├── /getting-started
│   ├── /keyboard-shortcuts
│   ├── /architecture (Technical Architecture)
│   └── /api (API Reference - if applicable)
├── /learn (Learning Resources)
│   ├── /tutorials
│   ├── /examples
│   └── /community
├── /support (Support)
│   ├── /faq
│   ├── /troubleshooting
│   ├── /known-issues
│   └── /report-issue
├── /contribute (Contribution)
│   ├── /code (Code Contributions)
│   ├── /non-code (Non-Code Contributions)
│   ├── /guidelines (Contribution Guidelines)
│   └── /roadmap (Public Roadmap)
├── /support-project (Financial Support)
│   ├── /why-support (Why Support Matters)
│   ├── /sponsors (Sponsorship Tiers)
│   └── /transparency (Financial Transparency)
├── /about (About)
│   ├── /story (Solo-Developer Story)
│   ├── /license (AGPL License)
│   ├── /privacy (Privacy Policy)
│   └── /security (Security Policy)
└── /blog (Blog - optional, if sustainable)
```

### 3.2 Page Purpose & Content

**Homepage (/):**
- Hero with product name, value proposition, download CTA, platform availability
- Product-in-action section with real screenshots
- Capability chapter previews (3-4 key areas)
- Solo-developer story teaser
- Download CTA
- Learning/support links

**Product Overview (/product):**
- What Strata is (local-first, cross-platform, native performance)
- Who it's for (primary audiences)
- Key capabilities at a glance
- Comparison with alternatives (honest)
- System requirements
- Platform support details

**Feature Chapters (/features/*):**
- Deep dives into major capability areas
- Technical depth (IR-replay, Rust engine, etc.)
- Real UI screenshots
- Workflow explanations
- Limitations (honest)
- Related documentation links

**Download (/download):**
- Platform detection (with manual override)
- Platform-specific packages:
  - Linux: AppImage (universal), deb (Debian/Ubuntu 22.04+), rpm (Fedora/RHEL), AUR (Arch/CachyOS)
  - macOS: Universal dmg (Intel + Apple Silicon, 13+)
  - Windows: MSI installer, NSIS installer
- Version number, release date, file size
- System requirements (actual dependencies from CI)
- Checksums (to be added)
- Installation instructions per platform
- Previous releases link
- Release notes link

**Releases (/releases):**
- Current version with summary
- Release notes (not raw git log)
- Feature additions, fixes, performance work
- Platform-specific changes
- Known issues
- Download linkage
- Archive of previous releases

**Documentation (/docs):**
- Getting Started guide
- Keyboard shortcuts reference
- Tool documentation
- Architecture overview (for technical audience)
- API reference (if applicable)
- Link to AGENTS.md (development guide)

**Learning (/learn):**
- Tutorial links (if exist) or roadmap for tutorials
- Example files (if available)
- Community resources
- External learning (if relevant)

**Support (/support):**
- FAQ
- Troubleshooting guide
- Known issues
- Bug report guidelines (version, OS, reproduction steps)
- Issue tracker link
- Community forum or GitHub Discussions

**Contribution (/contribute):**
- Code contribution guidelines
- Non-code contributions (testing, documentation, design, translations)
- Good first issues
- Development setup
- Code of conduct
- AGPL contribution implications

**Support Project (/support-project):**
- Why support matters (solo-developer reality)
- What support enables (specific features, stability, platform support)
- Sponsorship tiers (GitHub Sponsors or Open Collective)
- Recurring vs one-time support
- Non-financial contribution emphasis
- Financial transparency (if using Open Collective)

**About (/about):**
- Solo-developer story (honest, not dramatic)
- AGPL license explanation (what it means, why it matters)
- Privacy policy (accurate to actual data practices)
- Security policy (reporting process, practices)

### 3.3 Navigation Architecture

**Top Navigation:**
- Product (dropdown: Overview, Features)
- Download
- Learn (dropdown: Docs, Tutorials, Community)
- Support (dropdown: FAQ, Troubleshooting, Report Issue)
- Contribute
- Support Project

**Footer:**
- Product
- Download
- Learn
- Support
- Contribute
- Project (About, License, Privacy, Security)
- Social links (GitHub, etc.)

---

## 4. Download Architecture

### 4.1 Source of Truth

**Primary:** GitHub Releases (https://github.com/strata/strata/releases)
- Triggered by git tags (v[0-9]+.[0-9]+.[0-9]+)
- Automatically generates draft releases via CI
- Uploads artifacts: AppImage, deb, rpm, dmg, msi, nsis
- Auto-generates release notes from commits

**Secondary (for website):**
- Static release manifest JSON (generated by CI, committed to repo or fetched at build time)
- Contains: version, release date, download URLs, checksums, file sizes, platform metadata

### 4.2 Platform Detection Strategy

**Client-side detection:**
```javascript
const platform = detectPlatform(); // returns 'linux', 'macos', 'windows', or 'unknown'
const architecture = detectArchitecture(); // returns 'x86_64', 'arm64', or 'unknown'

// Show recommended download based on detection
// Always allow manual override
```

**Detection logic:**
- Linux: `navigator.userAgent.includes('Linux')` → recommend AppImage (universal)
- macOS: `navigator.userAgent.includes('Mac')` → recommend Universal dmg
- Windows: `navigator.userAgent.includes('Windows')` → recommend MSI

**Manual override:**
- Platform selector tabs (Linux / macOS / Windows)
- Architecture selector (if applicable)
- Package format selector (AppImage / deb / rpm / dmg / msi / nsis)

**Linux specificity:**
- Default to AppImage (universal, works on any x86_64 Linux)
- Offer deb for Debian/Ubuntu users
- Offer rpm for Fedora/RHEL users
- Offer AUR instructions for Arch/CachyOS users
- Distinguish: "Officially tested on: CachyOS, Arch, Ubuntu 22.04+, Fedora"
- Do not claim universal Linux support without testing

### 4.3 Integrity & Trust

**To be implemented:**
1. **Checksums:** Generate SHA256 checksums for all artifacts in CI
2. **Signatures:** Add GPG signatures for artifacts (if feasible for solo developer)
3. **Checksum display:** Show SHA256 on download page for each package
4. **Verification instructions:** How to verify checksums/signatures

**Current state (honest):**
- No code signing (not implemented)
- No notarization (not implemented)
- No checksums (to be added)
- Be honest about this in Security section

### 4.4 System Requirements

**Based on actual CI dependencies:**

**Linux:**
- OS: CachyOS, Arch Linux, Ubuntu 22.04+, Fedora, RHEL (officially tested on CachyOS/Arch)
- CPU: x86_64
- RAM: 4GB minimum, 8GB recommended
- GPU: Not required (Canvas2D renderer)
- Dependencies:
  - libwebkit2gtk-4.1-0
  - libgtk-3-0
  - libglib2.0-0
  - libsoup-3.0-0
  - librsvg2-2
  - libssl3
  - libgdk-pixbuf-2.0-0
  - libcairo2
  - libpango-1.0-0
  - libfontconfig1
- Display: Wayland or X11 (Wayland primary dev environment)

**macOS:**
- OS: macOS 13 Ventura or later
- CPU: Intel or Apple Silicon (Universal binary)
- RAM: 4GB minimum, 8GB recommended
- Storage: 500MB for application

**Windows:**
- OS: Windows 10 or Windows 11
- CPU: x86_64
- RAM: 4GB minimum, 8GB recommended
- Storage: 500MB for application

---

## 5. Support Architecture

### 5.1 Tiered Support Model

**Tier 1: Self-Service (90% of queries)**
- Documentation (/docs)
- FAQ (/support/faq)
- Troubleshooting guide (/support/troubleshooting)
- Known issues (/support/known-issues)
- Keyboard shortcuts (/docs/keyboard-shortcuts)

**Tier 2: Community (8% of queries)**
- GitHub Discussions (for general questions)
- GitHub Issues (for bug reports, feature requests)
- Community moderation by contributors
- Response time: 24-72 hours (community)

**Tier 3: Developer (2% of queries)**
- Security reports (private disclosure process)
- Critical bugs (workarounds, timeline)
- Licensing questions (AGPL clarification)
- Response time: 48-96 hours (solo developer capacity)

### 5.2 Issue Reporting Guidelines

**Bug report template:**
```
**Strata Version:** [from Help > About]
**Operating System:** [e.g., CachyOS Linux, Ubuntu 22.04, macOS 14, Windows 11]
**Architecture:** [e.g., x86_64, ARM64]
**Package:** [e.g., AppImage, deb, dmg, msi]

**Description:**
[Brief description of the bug]

**Steps to Reproduce:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Expected Behavior:**
[What should happen]

**Actual Behavior:**
[What actually happens]

**Logs/Screenshots:**
[Attach relevant logs or screenshots, mask personal data]
```

**Feature request template:**
```
**Problem Statement:**
[What problem are you trying to solve?]

**Proposed Solution:**
[What feature would solve this?]

**Alternatives Considered:**
[What alternatives have you considered?]

**Additional Context:**
[Links to related issues, screenshots, examples]
```

### 5.3 Response Time Expectations

**Be honest about solo-developer capacity:**
- Bug reports: "I review issues within 1 week. Critical bugs are prioritized."
- Feature requests: "Added to roadmap for consideration. No timeline guaranteed."
- Questions: "Community forum is faster than direct contact."

**Avoid:**
- "24/7 support"
- Guaranteed response times
- Enterprise SLAs
- Phone support
- Live chat

---

## 6. Contribution Strategy

### 6.1 Code Contributions

**Path:**
1. Read contribution guidelines
2. Set up development environment (AGENTS.md)
3. Check for "good first issue" labels
4. Fork repository, create branch
5. Make changes, add tests
6. Submit pull request
7. Code review (may take time due to solo developer)

**AGPL Implications:**
- All contributions must be AGPL-3.0-or-later
- Contributor retains copyright, grants license
- Explain this clearly in contribution guidelines

### 6.2 Non-Code Contributions

**Emphasize these are equally valuable:**
- **Testing:** Test on different platforms, report bugs, verify fixes
- **Documentation:** Improve docs, write tutorials, translate
- **Design:** Create UI mockups, icon designs, website improvements
- **Community:** Answer questions in Discussions, help other users
- **Accessibility:** Test with screen readers, report a11y issues
- **Platform testing:** Test on specific Linux distributions, macOS versions, Windows versions

**Recognition:**
- Contributors section in About page
- Release notes acknowledgment (with permission)
- GitHub contributor list (automatic)

### 6.3 Contribution Guidelines

**Include:**
- Code of conduct (be respectful, inclusive)
- Development setup (from AGENTS.md)
- Testing requirements (run `just gate`)
- Commit message conventions
- Pull request process
- AGPL licensing implications

---

## 7. Financial Support Strategy

### 7.1 Recommended Platform: GitHub Sponsors

**Rationale:**
- Integrated with existing GitHub repository
- Professional invoicing for corporate sponsors
- Global reach (103 regions)
- Tax compliance handled by platform
- Lower administrative burden for solo developer

**Alternative: Open Collective**
- Use if fiscal hosting is needed (nonprofit umbrella)
- Better for community transparency (public ledgers)
- More flexible contribution types
- Higher administrative complexity

**Decision:** Start with GitHub Sponsors for simplicity. Consider Open Collective if community transparency becomes priority or fiscal hosting is needed.

### 7.2 Sponsorship Tiers

**Suggested tiers (example):**

**Bronze ($5-10/month):**
- Name on supporters page
- Discord/badge (if implemented)
- Early access to release notes

**Silver ($25-50/month):**
- All Bronze benefits
- Logo on supporters page
- Priority bug consideration (not guarantee)
- Monthly development update email

**Gold ($100-500/month):**
- All Silver benefits
- Featured supporter spotlight
- Input on roadmap priorities
- Direct communication channel

**Corporate ($500+/month):**
- All Gold benefits
- Company logo on homepage
- Priority feature consideration
- SLA for critical bugs
- Custom integration support (if feasible)

**One-time support:**
- Also welcome
- Recognition on supporters page
- No recurring commitment

### 7.3 Messaging Guidelines

**Do:**
- Explain what support enables (specific features, platform support, stability)
- Be transparent about how funds are used
- Emphasize that non-financial contribution is equally valuable
- Show progress when funded features are delivered

**Don't:**
- Use guilt or manipulation
- Create fake urgency or countdowns
- Claim tax deductibility without legal basis
- Call payments "donations" if AGPL makes it more like licensing
- Overpromise what support will deliver

### 7.4 Support Page Content

**Sections:**
1. **Why support matters:** Solo-developer reality, what funding enables
2. **What support enables:** Specific examples (Linux ARM support, advanced typography, collaboration features)
3. **Sponsorship tiers:** Clear benefits, pricing
4. **Non-financial contribution:** Emphasize testing, documentation, design
5. **Transparency:** How funds are used (if using Open Collective) or general allocation
6. **Current priorities:** What I'm working on, what's next

---

## 8. Technical Architecture

### 8.1 Technology Stack

**Recommended: Static Site Generator**
- **Astro** (modern, fast, React-friendly, good DX)
- **Next.js** (if dynamic features needed later)
- **11ty** (if prefer simpler, template-based)

**Why static:**
- Solo-developer maintenance (no database, no server)
- Fast performance (CDN edge caching)
- Low cost (can host on GitHub Pages, Netlify, Vercel free tier)
- Security (no server-side vulnerabilities)
- Reliability (no server downtime)

### 8.2 Deployment Strategy

**Recommended: GitHub Pages**
- Free hosting
- Automatic deployment on git push
- Custom domain support
- HTTPS automatic
- Integrated with GitHub repository

**Alternative: Netlify or Vercel**
- Faster builds
- Preview deployments
- Edge functions (if needed later)
- Free tier sufficient for static site

### 8.3 Design System Integration

**Use existing Strata design tokens:**
- Colors from `packages/ui/src/tokens/`
- Typography from brand guide
- Icons from Lucide (already used in app)
- Spacing, radii, shadows from existing tokens

**Adaptation for marketing site:**
- Larger type sizes for editorial feel
- More expressive layouts (not constrained by app UI patterns)
- Richer imagery (screenshots, videos)
- Deliberate whitespace and visual rhythm

### 8.4 Release Data Integration

**Option 1: Static manifest (recommended)**
- CI generates `releases.json` with latest version info
- Committed to repo or fetched at build time
- Website reads manifest at build or runtime
- Simple, no API calls, no server

**Option 2: GitHub API**
- Fetch release data from GitHub API at build time
- More dynamic, requires API rate limit consideration
- Better for always-current data

**Decision:** Start with static manifest (Option 1) for simplicity. Move to GitHub API (Option 2) if real-time data becomes critical.

### 8.5 Analytics Strategy

**Recommended: Plausible Analytics**
- Privacy-focused (no cookies, GDPR compliant)
- Lightweight (script < 1KB)
- Open source
- Simple dashboard
- Affordable for solo developer

**What to track:**
- Page views (overall and per page)
- Download CTA clicks
- Platform selection (Linux/macOS/Windows)
- Referrers (where traffic comes from)
- Device/browser breakdown

**What NOT to track:**
- Personal identifiers
- User sessions
- Location data
- Fingerprinting
- Invasive analytics

### 8.6 SEO Strategy

**Technical SEO:**
- Meta titles and descriptions for each page
- Canonical URLs
- Open Graph tags (title, description, image)
- Twitter Card tags
- Sitemap.xml (auto-generated)
- Robots.txt
- Structured data (SoftwareApplication schema)
- Fast Core Web Vitals (LCP < 2.5s, CLS < 0.1, FID < 100ms)

**Content SEO:**
- Keywords: "local-first design tool", "cross-platform design software", "Linux design app", "Rust design engine"
- Blog posts (if sustainable): Tutorials, feature deep-dives, development updates
- Documentation indexing (technical content ranks well)

---

## 9. Content Hierarchy

### 9.1 Homepage Structure

**Hero Section:**
- Product name: "Strata"
- Tagline: "Local-first, cross-platform design suite"
- Subtagline: "Native Rust performance. No cloud lock-in. No subscription."
- Primary CTA: "Download for [Platform]" (detected or manual)
- Secondary CTA: "Learn more"
- Platform availability: "Linux • macOS • Windows"

**Product-in-Action Section:**
- Large screenshot of actual app UI
- Caption: "Real tools, real performance, real local data"
- Short video (if available) or animated GIF showing canvas interaction

**Capability Chapters (3-4 key areas):**
1. **Canvas & Rendering:** "86fps IR-replay rendering, infinite canvas, precision tools"
2. **Motion & Prototyping:** "Timeline-based animation, Smart Animate, prototype interactions"
3. **Export & Code Gen:** "SVG, React/Tailwind, Flutter, SwiftUI — export to code"
4. **Vector & Typography:** "Complete vector tools, text engine, color management"

**Each chapter preview:**
- 2-3 sentence description
- Small screenshot or icon
- "Learn more" link to feature chapter page

**Solo-Developer Story Teaser:**
- "Built independently by one designer-developer"
- "Transparent development, honest limitations, community input"
- "Read the story" link to About page

**Download Section:**
- "Download Strata" heading
- Platform selector (Linux/macOS/Windows)
- Package format selector
- "System requirements" link
- "Previous releases" link

**Learning & Support Links:**
- "Documentation"
- "Tutorials" (or "Coming soon" if not available)
- "Support"
- "Community"

### 9.2 Feature Chapter Structure

**Template for each feature chapter:**

**Hero:**
- Feature name: "Canvas & Rendering"
- One-sentence value proposition
- Large screenshot or video

**What It Is:**
- Technical explanation (IR-replay architecture, Rust engine)
- What users can do with it
- Why it matters

**How It Works:**
- Workflow explanation
- Key capabilities
- Technical depth (86fps, viewport culling, dirty-rect redraw)

**Real UI:**
- Screenshots of actual app
- Annotations explaining key elements
- Before/after examples (if applicable)

**Limitations:**
- Honest about what's not implemented
- "In Development" features
- Platform-specific limitations

**Related Documentation:**
- Links to relevant docs
- Keyboard shortcuts
- Troubleshooting

### 9.3 Download Page Structure

**Platform Detection:**
- "We detected you're on [Platform]. Download for [Platform]?"
- Manual override: "Or choose another platform:"

**Platform Sections:**

**Linux:**
- "AppImage (Recommended)" - universal, works on any x86_64 Linux
- "deb Package" - Debian/Ubuntu 22.04+
- "rpm Package" - Fedora/RHEL
- "AUR" - Arch/CachyOS (with yay/pacman instructions)
- System requirements
- Installation instructions per package

**macOS:**
- "Universal dmg" - Intel + Apple Silicon, macOS 13+
- System requirements
- Installation instructions

**Windows:**
- "MSI Installer" - recommended for most users
- "NSIS Installer" - alternative
- System requirements
- Installation instructions

**Release Information:**
- Current version: [from CI]
- Release date: [from CI]
- File sizes
- Checksums (SHA256)
- Release notes link

**Previous Releases:**
- Link to /releases page

---

## 10. Accessibility Strategy

### 10.1 WCAG 2.2 AA Target

**Key requirements:**
- Semantic HTML (proper heading hierarchy, landmarks)
- Keyboard navigation (all interactive elements accessible via keyboard)
- Focus management (visible focus, logical focus order)
- Skip links (skip to main content, skip navigation)
- Color contrast (4.5:1 for normal text, 3:1 for large text)
- Zoom support (200% zoom without horizontal scroll)
- Screen reader support (ARIA labels where needed, alt text for images)
- Reduced motion (respect `prefers-reduced-motion`)
- Error identification (clear error messages)
- Form labels (all inputs have labels)

### 10.2 Testing

**Automated:**
- axe-core Playwright tests (already in Strata CI)
- Lighthouse accessibility audits
- Pa11y CI integration

**Manual:**
- Keyboard-only navigation
- Screen reader testing (NVDA on Windows, VoiceOver on macOS, Orca on Linux)
- High contrast mode testing
- Zoom testing (200%)
- Mobile screen reader testing

---

## 11. Performance Strategy

### 11.1 Targets

**Core Web Vitals:**
- LCP (Largest Contentful Paint): < 2.5s
- CLS (Cumulative Layout Shift): < 0.1
- FID (First Input Delay): < 100ms
- INP (Interaction to Next Paint): < 200ms

**Performance budget:**
- JavaScript: < 100KB gzipped (excluding framework)
- CSS: < 50KB gzipped
- Images: < 500KB per image (WebP/AVIF with fallbacks)
- Fonts: < 100KB total (subsetted if possible)

### 11.2 Optimization Techniques

**Images:**
- Responsive images (srcset)
- Next-gen formats (WebP/AVIF with JPEG/PNG fallbacks)
- Lazy loading (below-the-fold images)
- Compression (optimization pipeline)

**Code:**
- Tree-shaking (remove unused code)
- Code splitting (route-based)
- Minification
- Gzip/Brotli compression

**Fonts:**
- Subset to used characters
- WOFF2 format
- `font-display: swap` for faster rendering

**Caching:**
- Long cache headers for static assets
- Service Worker for offline support (if feasible)

---

## 12. Security & Privacy Strategy

### 12.1 Security

**Website security:**
- HTTPS only (enforced)
- Content Security Policy (CSP)
- Subresource Integrity (SRI) for external scripts
- No eval() or inline scripts
- Regular dependency audits (npm audit, GitHub Dependabot)
- Security headers (X-Frame-Options, X-Content-Type-Options, etc.)

**Download security:**
- HTTPS for all downloads
- Checksums (SHA256) for artifact verification
- GPG signatures (if implemented)
- Clear communication about signing status

**Vulnerability reporting:**
- Private disclosure process (security@ email or GitHub Security Advisory)
- Response timeline (acknowledge within 48 hours)
- Coordinated disclosure for critical vulnerabilities

### 12.2 Privacy

**Data collection:**
- Analytics: Plausible (privacy-focused, no cookies, no personal data)
- No user tracking
- No fingerprinting
- No marketing cookies
- No third-party trackers

**Privacy policy:**
- Clear statement of what data is collected (if any)
- How data is used
- Data retention policy
- User rights
- Contact for privacy questions

**Forms:**
- Only collect necessary information
- Clear purpose for each field
- Secure form submission (HTTPS)
- No data sold to third parties

---

## 13. Implementation Roadmap

### 13.1 Phase 1: Foundations (Week 1-2)

- Set up static site generator (Astro)
- Integrate Strata design tokens
- Create basic layout (header, footer, navigation)
- Set up CI/CD for deployment (GitHub Pages or Netlify)
- Configure analytics (Plausible)
- Create basic pages: Homepage, Download, About

### 13.2 Phase 2: Core Content (Week 3-4)

- Write Homepage content
- Create Product Overview page
- Create Download page with platform detection
- Create About page (solo-developer story, license, privacy)
- Create Support page (FAQ, troubleshooting)
- Set up release data integration (static manifest)

### 13.3 Phase 3: Feature Chapters (Week 5-6)

- Create Canvas & Rendering chapter
- Create Vector Tools chapter
- Create Typography chapter
- Create Color & Effects chapter
- Create Motion & Prototyping chapter
- Create Export & Code Generation chapter
- Add real screenshots and videos

### 13.4 Phase 4: Ecosystem (Week 7-8)

- Create Documentation section (Getting Started, Keyboard Shortcuts)
- Create Learning section (tutorials roadmap, community links)
- Create Contribution section (guidelines, good first issues)
- Create Support Project section (GitHub Sponsors integration)
- Create Releases page
- Implement search (if needed)

### 13.5 Phase 5: Hardening (Week 9-10)

- Accessibility audit (axe-core, manual testing)
- Performance optimization (Core Web Vitals)
- SEO optimization (meta tags, sitemap, structured data)
- Security audit (headers, CSP, dependencies)
- Responsive testing (mobile, tablet, desktop)
- Cross-browser testing (Chrome, Firefox, Safari, Edge)

### 13.6 Phase 6: Launch (Week 11-12)

- Independent review (fresh subagent)
- Final verification (all journeys)
- Documentation update
- Domain/DNS configuration
- Launch announcement
- Monitor and iterate

---

## 14. Success Metrics

### 14.1 Technical Metrics

- **Performance:** Core Web Vitals green (LCP < 2.5s, CLS < 0.1, INP < 200ms)
- **Accessibility:** axe-core zero violations, WCAG 2.2 AA compliant
- **SEO:** Indexed by Google, organic traffic growth
- **Uptime:** 99.9%+ (static site, should be easy)

### 14.2 Business Metrics

- **Download conversion:** Homepage visitors → Download page → Download completion
- **Platform distribution:** Linux vs macOS vs Windows downloads
- **Support conversion:** Visitors → Support Project page → Sponsor sign-up
- **Documentation engagement:** Page views, time on page, bounce rate
- **Community engagement:** GitHub stars, issues, PRs, Discussions activity

### 14.3 Quality Metrics

- **Link health:** No broken links (automated check)
- **Content accuracy:** No false claims (verified against Product Truth Matrix)
- **Platform accuracy:** Downloads work for stated platforms
- **Support responsiveness:** Issue response time < 1 week

---

## 15. Risk Mitigation

### 15.1 Solo-Developer Capacity

**Risk:** Cannot maintain website and respond to support at scale

**Mitigation:**
- Static site minimizes maintenance
- Tiered support model (90% self-service)
- Community contribution for documentation
- Honest response time expectations
- Prioritize stability over new features

### 15.2 Over-Marketing

**Risk:** Website makes claims that app cannot back up

**Mitigation:**
- Product Truth Matrix as single source of truth
- Honest limitations sections
- "In Development" labels for partial features
- Regular audits against codebase
- Independent review before launch

### 15.3 Platform Support Changes

**Risk:** CI changes break download links or platform support

**Mitigation:**
- Release data from single source of truth (GitHub Releases)
- Automated testing of download links
- Clear communication when platforms are added/removed
- Archive previous releases

### 15.4 AGPL Misunderstanding

**Risk:** Users confused by AGPL license or feel misled

**Mitigation:**
- Clear AGPL explanation on website
- Honest about what AGPL means for users
- Distinguish from permissive open source
- Provide FAQ for licensing questions
- Consider dual-licensing if commercial demand exists

---

## 16. Next Steps: Phase D - Foundations

With Phase C (Strategy) complete, proceed to Phase D to implement:

1. **Design system integration**: Adapt Strata tokens for web use
2. **Routing architecture**: Set up static site generator with routing
3. **Content architecture**: Create content structure in CMS or markdown
4. **Metadata implementation**: Add meta tags, Open Graph, structured data
5. **Accessibility foundations**: Semantic HTML, skip links, ARIA where needed
6. **Development environment**: Local dev setup, CI/CD configuration
