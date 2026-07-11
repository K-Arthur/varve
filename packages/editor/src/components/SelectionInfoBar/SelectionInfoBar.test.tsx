/**
 * SelectionInfoBar tests — selection feedback strip rendering.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../../context';
import { SelectionInfoBar } from './SelectionInfoBar';

describe('SelectionInfoBar', () => {
  it('renders without crashing', () => {
    function Test() {
      return <SelectionInfoBar />;
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );
    expect(screen.getByText(/layers/i)).toBeInTheDocument();
  });
});
