/**
 * Varve validation impact configuration.
 *
 * This file encodes the EXCEPTIONAL risk rules that a static dependency
 * graph cannot discover on its own: implicit dependencies, high-risk
 * surfaces, and intentional validation broadening.
 *
 * Rules are kept deliberately small. Everything derivable from the
 * workspace graph (package deps, crate deps, file -> package mapping,
 * reverse dependents) is computed by scripts/quality/affected-plan.mjs.
 *
 * Every rule added here must explain WHY it exists, and must reference
 * real paths/lanes. scripts/quality/audit-impact-config.mjs (run by
 * tests/unit/validationPolicy.test.ts) rejects rules that match nothing,
 * reference unknown lanes, or duplicate existing rules.
 *
 * Lane vocabulary (must match scripts/quality/validation-lanes.mjs):
 *   js-unit:<package>       vitest tests for one workspace package
 *   js-unit:all             full root vitest suite
 *   js-unit:file:<path>     one specific test file
 *   typecheck:<package>     package-scoped tsc
 *   typecheck:all           full workspace typecheck
 *   lint:<target>           biome lint (target: touched|all)
 *   format:<target>         biome format (target: touched|all)
 *   rust-test:<crate>       cargo test for one crate
 *   rust-test:all           cargo test --workspace --all-targets
 *   rust-clippy:<crate>     clippy for one crate
 *   cargo-fmt               cargo fmt --check
 *   e2e:<domain>            playwright specs for one tests/e2e/<domain>
 *   e2e:visual              visual regression projects
 *   e2e:all                 full playwright run
 *   desktop-native          tauri build + wdio suite
 *   website-unit            vitest run apps/website/src/test
 *   website-e2e             website build + website playwright config
 *   bench:<domain>          perf benchmark corpus
 *   wasm                    wasm32 check/build
 *   models                  model manifest/checksum validation
 *   audit:tokens|emoji|docs|health|architecture
 *   ci-tools                scripts/*.test.mjs + shell script tests
 *   policy                  validation-policy.test.ts (this system's own tests)
 *   full                    everything (Tier 5)
 */

export const IMPACT_CONFIG = {
  schema: 1,

  /**
   * Paths that must ALWAYS escalate to full validation (Tier 5) because a
   * change to them can invalidate the selection logic itself or every
   * package's compile/test contract at once.
   */
  fullEscalationPaths: [
    // Workspace / toolchain
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'biome.json',
    'justfile',
    'Cargo.toml',
    'Cargo.lock',
    'rustfmt.toml',
    'vitest.config.ts',
    'vitest.bench.config.ts',
    'vitest.setup.ts',
    'vitest.mocks.ts',
    // Test-runner configuration that can invalidate test selection
    'playwright.config.ts',
    'playwright.*.config.ts',
    'wdio.conf.ts',
    'stryker.conf.json',
    // Validation infrastructure itself
    'scripts/quality/**',
    'scripts/quality/**',
    'validation-impact.config.*',
    // Release / signing / packaging infrastructure
    'apps/desktop/src-tauri/tauri.conf.json',
    'apps/desktop/src-tauri/tauri.*.conf.json',
    'apps/desktop/src-tauri/Cargo.toml',
    'scripts/release/**',
    '.github/workflows/**',
  ],

  /**
   * Paths that force the full-suite-typecheck lane (Tier 3+ equivalent
   * for shared compile contracts) without necessarily requiring every
   * integration test. A subset of fullEscalationPaths kept separate so
   * the planner can distinguish "everything" from "all typechecks".
   */
  sharedContractPaths: [
    // Shared foundational packages: dependency closure handles the rest,
    // these just guarantee the closure is computed even if the static
    // graph misses a runtime-only reference.
    'packages/shared/src/**',
    'packages/scene/src/document.ts',
    'packages/scene/src/document-nodes.ts',
    'packages/scene/src/node-id.ts',
    // Serialization / file format
    'packages/scene/src/version-migrations*.ts',
    'packages/scene/src/colorMigration.ts',
    'packages/scene/src/version.ts',
    // Engine IR contract
    'packages/engine/src/replay.ts',
    'packages/engine/src/types.ts',
    'packages/engine/src/engine.ts',
    // Platform facade
    'packages/platform/src/index.ts',
    'packages/editor/src/commands/**',
    'packages/editor/src/actions/**',
    // IPC protocol
    'apps/desktop/src-tauri/src/lib.rs',
    'crates/varve-bridge/src/**',
  ],

  /**
   * Implicit dependency rules: source path glob -> required lanes.
   *
   * These exist ONLY where static imports cannot see the dependency
   * (runtime registries, string-keyed wiring, generated artifacts,
   * cross-language contracts). Each rule states why.
   */
  impactRules: [
    {
      id: 'canvas-renderer-e2e',
      why: 'The canvas renderer is exercised through the real DOM/E2E corpus; unit tests cannot see compositing order, camera projection, or overlay layout bugs.',
      paths: [
        'packages/editor/src/canvas/**',
        'packages/editor/src/render/**',
        'packages/compositor/src/**',
        'packages/engine/src/replay.ts',
        'packages/engine/src/replay.ts',
      ],
      require: ['e2e:canvas', 'bench:render'],
    },
    {
      id: 'settings-e2e',
      why: 'Settings state is persisted and read at startup; the E2E spec is the only proof the dialog still wires up.',
      paths: ['packages/editor/src/components/Settings/**', 'packages/editor/src/settings.ts'],
      require: ['e2e:settings'],
    },
    {
      id: 'tokens-visual',
      why: 'Design tokens are consumed by CSS custom properties at runtime; the token audit plus a UI visual smoke is required, not just unit tests.',
      paths: ['packages/ui/src/tokens/**', 'packages/tokens/src/**', 'packages/ui/src/tokens/**'],
      require: ['audit:tokens', 'e2e:visual'],
    },
    {
      id: 'keyboard-infra-e2e',
      why: 'Shortcut registry is string-keyed; keyboard E2E proves bindings survive refactors.',
      paths: [
        'packages/editor/src/shortcuts/**',
        'packages/editor/src/actions/**',
        'packages/editor/src/actions/**',
      ],
      require: ['e2e:keyboard'],
    },
    {
      id: 'tauri-commands-native',
      why: 'Rust IPC command names are referenced by string from TS; only the native desktop suite proves the wire contract.',
      paths: [
        'apps/desktop/src-tauri/src/**',
        'packages/platform/src/**',
        'crates/varve-bridge/src/**',
        'packages/editor/src/actions/ActionRegistry.ts',
        'packages/editor/src/actions/index.ts',
      ],
      require: ['desktop-native'],
    },
    {
      id: 'serialization-roundtrip',
      why: 'Document schema changes must prove backwards compatibility, not just forward compile.',
      paths: [
        'packages/scene/src/version-migrations*.ts',
        'packages/scene/src/version.ts',
        'packages/scene/src/migrateIds.ts',
        'packages/scene/src/documentCodec.ts',
        'crates/varve-sync/src/**',
      ],
      require: ['js-unit:scene', 'js-unit:import', 'e2e:export'],
    },
    {
      id: 'model-assets-light',
      why: 'Large ONNX/media assets live under shared dirs but must not fan out into every TS test; manifest/checksum + inference tests only.',
      paths: ['apps/desktop/public/models/**', 'models-source/**'],
      require: ['models'],
    },
    {
      id: 'wasm-boundary',
      why: 'Rust wasm crates and their TS facades are compiled for a second target; the wasm check catches target-specific breakage unit tests miss.',
      paths: [
        'crates/varve-wasm/**',
        'crates/varve-colour/src/**',
        'crates/varve-engine/src/**',
        'crates/varve-core/src/**',
      ],
      require: ['wasm', 'rust-clippy:varve-wasm'],
    },
    {
      id: 'import-export-domain',
      why: 'Import/export parsers and fixtures are cross-language; unit tests plus the import/export E2E corpus cover the roundtrip.',
      paths: [
        'packages/import/src/**',
        'packages/editor/src/export/**',
        'packages/codegen/src/**',
        'tests/fixtures/**',
      ],
      require: ['e2e:import', 'e2e:export'],
    },
    {
      id: 'motion-domain',
      why: 'Motion is timeline-driven state; its E2E corpus is the integration proof.',
      paths: ['packages/editor/src/motion/**', 'packages/prototype/src/**'],
      require: ['e2e:motion'],
    },
    {
      id: 'home-domain',
      why: 'Home surface has its own E2E corpus and must stay green for file-management changes.',
      paths: ['packages/home/src/**'],
      require: ['e2e:home'],
    },
    {
      id: 'website-only-light',
      why: 'Website changes must never drag in Rust/editor validation; website lanes only.',
      paths: ['apps/website/**'],
      require: ['website-unit', 'website-e2e'],
    },
    {
      id: 'docs-only-light',
      why: 'Docs changes need audit:docs + format/lint, not product tests.',
      paths: ['docs/**', '*.md'],
      require: ['audit:docs'],
    },
    {
      id: 'rust-engine-render-perf',
      why: 'Rust engine rendering changes must pass the render perf ratio gate, not just correctness tests.',
      paths: [
        'crates/varve-engine/src/lib.rs',
        'crates/varve-engine/src/lib.rs',
        'crates/varve-core/src/geom.rs',
        'packages/engine/src/bench/**',
      ],
      require: ['bench:render', 'rust-test:varve-engine'],
    },
    {
      id: 'test-infra-broaden',
      why: 'Changes to test infrastructure must not use affected-selection to prove the selector itself.',
      paths: [
        'vitest.setup.ts',
        'vitest.mocks.ts',
        'tests/unit/**',
        'tests/e2e/shared.ts',
        'tests/e2e/helpers/**',
        'tests/e2e/fixtures/**',
        'scripts/quality/**',
        'tests/unit/validationPolicy.test.ts',
      ],
      require: ['policy', 'ci-tools'],
    },
  ],

  /**
   * Dependency-upgrade risk classification.
   * package name glob -> escalation tier (medium = Tier 2+ in all
   * dependents; high = Tier 4/5).
   */
  dependencyUpgradeRules: [
    {
      why: 'Shared runtime/framework/toolchain upgrades can break every package; high-risk.',
      packages: [
        'react',
        'react-dom',
        'typescript',
        'vitest',
        'vite',
        'playwright',
        '@playwright/test',
        'tauri',
        '@tauri-apps/api',
        '@tauri-apps/cli',
        'onnxruntime-web',
        'biome',
        '@biomejs/biome',
        'pnpm',
        'esbuild',
      ],
      risk: 'high',
    },
    {
      why: 'Package-local runtime deps get dependent-package validation.',
      packages: ['@floating-ui/dom', 'lucide-react', 'fast-check', 'jsdom', 'stylelint'],
      risk: 'medium',
    },
  ],

  /**
   * E2E domain -> tests/e2e directory mapping. Derived mechanically from
   * the filesystem at plan time; this list exists only so the plan can
   * express "the whole domain" for a directory that holds no spec files
   * at the top level.
   */
  e2eDomains: {
    canvas: ['tests/e2e/canvas/**'],
    settings: ['tests/e2e/settings/**'],
    menus: ['tests/e2e/menus/**'],
    export: ['tests/e2e/export/**'],
    layers: ['tests/e2e/layers/**'],
    motion: ['tests/e2e/motion/**'],
    home: ['tests/e2e/home/**'],
    keyboard: [
      'tests/e2e/canvas/keyboard-nav.spec.ts',
      'tests/e2e/canvas/input-navigation.spec.ts',
    ],
    a11y: ['tests/e2e/a11y/**'],
    visual: ['tests/e2e/visual/**'],
    startup: ['tests/e2e/startup/**'],
    webgpu: ['tests/e2e/webgpu/**'],
    tauri: ['tests/e2e/tauri/**'],
    save: ['tests/e2e/save/**'],
    thumbnails: ['tests/e2e/thumbnails/**'],
    workspace: ['tests/e2e/workspace/**'],
    logo: ['tests/e2e/logo/**'],
    effects: ['tests/e2e/effects/**'],
    'gradient-map': ['tests/e2e/gradient-map/**'],
    models: ['tests/e2e/model-quality/**'],
    icons: ['tests/e2e/icons/**'],
    inspector: ['tests/e2e/inspector/**'],
    intelligence: ['tests/e2e/intelligence/**'],
    crash: ['tests/e2e/crash/**'],
    workflow: ['tests/e2e/workflow/**'],
    format: ['tests/e2e/format/**'],
    editor: ['tests/e2e/editor/**'],
  },
};
