// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreflightWarnings } from './PreflightWarnings';

// The component uses useEditor() which throws if not within EditorProvider.
// Basic structural tests are below; full integration testing requires EditorProvider.

describe('PreflightWarnings', () => {
  it('renders null when no editor context (throws without provider)', () => {
    expect(() => render(<PreflightWarnings />)).toThrow('useEditor');
  });
});
