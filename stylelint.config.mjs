export default {
  extends: ['stylelint-config-standard'],
  rules: {
    'color-no-hex': true,
    'color-named': null,
    'alpha-value-notation': null,
    'lightness-notation': null,
    'hue-degree-notation': null,
    'value-keyword-case': null,
    'comment-empty-line-before': null,
    'declaration-empty-line-before': null,
    'rule-empty-line-before': null,
    'at-rule-empty-line-before': null,
    /* Re-enabled 2026-09-19: this rule is exactly what would have caught the
     * elevation/surface alias overwriting the audited surface tokens inside a
     * single theme block. It is now clean, so it stays enforced. */
    'declaration-block-no-duplicate-custom-properties': true,
    'length-zero-no-unit': null,
    /* The shell chains `:not(a):not(b)` deliberately: the chained form composes
     * specificity, while the `:not(a, b)` list form takes the maximum, which
     * would change which rules win. Keep the simple notation. */
    'selector-not-notation': 'simple',
    'selector-class-pattern': [
      '^[a-z][a-zA-Z0-9]*(-[a-zA-Z0-9]+)*(__[a-z][a-zA-Z0-9]*(-[a-zA-Z0-9]+)*)?(--[a-z][a-zA-Z0-9]*(-[a-zA-Z0-9]+)*)?$',
      {
        resolveNestedSelectors: true,
        message: 'Expected BEM-style class naming',
        severity: 'warning',
      },
    ],
    'color-function-notation': null,
    'color-function-alias-notation': null,
    /* `-webkit-appearance` / `-moz-appearance` stay alongside the unprefixed
     * form: the design system ships to WebKitGTK, WKWebView, and Gecko, and
     * the prefixed form is what removes native control chrome there. */
    'property-no-vendor-prefix': [
      true,
      { ignoreProperties: ['-webkit-appearance', '-moz-appearance'] },
    ],
    'no-descending-specificity': null,
    'custom-property-empty-line-before': null,
    'declaration-property-value-keyword-no-deprecated': null,
    'no-duplicate-selectors': null,
    'media-feature-range-notation': null,
    'declaration-block-no-redundant-longhand-properties': null,
  },
  ignoreFiles: [
    'node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.worktrees/**',
    'apps/desktop/public/**',
    'apps/website/dist/**',
    'apps/website/dist-pages/**',
    'playwright-report/**',
    'test-results/**',
    '**/test-results/**',
    'packages/engine/src/__goldens__/**',
    'packages/ui/src/components/StartupLoader.css',
  ],
};
