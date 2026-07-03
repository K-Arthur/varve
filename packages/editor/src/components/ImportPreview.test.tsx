// @vitest-environment jsdom

import type { ImportValidation } from '@strata/import';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportPreview } from './ImportPreview';

afterEach(cleanup);

function makeValidation(overrides: Partial<ImportValidation> = {}): ImportValidation {
  return {
    valid: true,
    format: 'svg',
    estimatedNodeCount: 42,
    unsupportedFeatures: [],
    warnings: [],
    pageCount: 1,
    sizeBytes: 1024,
    ...overrides,
  };
}

describe('ImportPreview', () => {
  it('shows file format and size', () => {
    const validation = makeValidation({ format: 'svg', sizeBytes: 2048 });
    const { container } = render(
      <ImportPreview validation={validation} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const values = container.querySelectorAll('.import-preview__value');
    expect(values[0]?.textContent).toBe('SVG');
    expect(values[1]?.textContent).toMatch(/2\.0 KB/);
  });

  it('shows estimated node count', () => {
    const validation = makeValidation({ estimatedNodeCount: 42 });
    const { container } = render(
      <ImportPreview validation={validation} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const values = container.querySelectorAll('.import-preview__value');
    expect(values[2]?.textContent).toBe('42');
  });

  it('shows unsupported feature warnings when present', () => {
    const validation = makeValidation({
      unsupportedFeatures: ['gradients will be approximated', 'filter effects not supported'],
    });
    const { container } = render(
      <ImportPreview validation={validation} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const items = container.querySelectorAll('.import-preview__warnings-list li');
    expect(items[0]?.textContent).toMatch(/gradients will be approximated/i);
    expect(items[1]?.textContent).toMatch(/filter effects not supported/i);
  });

  it('shows import options (editable vs flattened)', () => {
    const validation = makeValidation();
    const { container } = render(
      <ImportPreview validation={validation} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const radios = container.querySelectorAll('input[name="importMode"]');
    expect(radios.length).toBe(2);
    expect((radios[0] as HTMLInputElement).value).toBe('editable');
    expect((radios[1] as HTMLInputElement).value).toBe('flattened');
  });

  it('calls onConfirm when import button clicked', () => {
    const onConfirm = vi.fn();
    const validation = makeValidation();
    const { container } = render(
      <ImportPreview validation={validation} onConfirm={onConfirm} onCancel={() => {}} />,
    );
    const btn = container.querySelector('.import-preview__btn--primary') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    const validation = makeValidation();
    const { container } = render(
      <ImportPreview validation={validation} onConfirm={() => {}} onCancel={onCancel} />,
    );
    const btn = container.querySelector('.import-preview__btn--secondary') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables import when validation says invalid', () => {
    const validation = makeValidation({ valid: false });
    const { container } = render(
      <ImportPreview validation={validation} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const btn = container.querySelector('.import-preview__btn--primary') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows warning count badge', () => {
    const validation = makeValidation({
      unsupportedFeatures: ['feature X', 'feature Y', 'feature Z'],
    });
    const { container } = render(
      <ImportPreview validation={validation} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.querySelector('.import-preview__warnings-title')?.textContent).toMatch(
      /3 unsupported features/i,
    );
  });
});
