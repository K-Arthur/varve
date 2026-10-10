import assert from 'node:assert/strict';
import { test } from 'node:test';
import { variantFileName, variantWidthsFor } from './variants.mjs';

test('variant file names keep the PNG stem and add width plus format', () => {
  assert.equal(variantFileName('workspace-light.png', 1440, 'webp'), 'workspace-light-1440.webp');
  assert.equal(variantFileName('layers-light.png', 720, 'avif'), 'layers-light-720.avif');
});

test('wide captures get a 720 candidate plus the source width', () => {
  assert.deepEqual(variantWidthsFor(1440), [720, 1440]);
  assert.deepEqual(variantWidthsFor(720), [720]);
  assert.deepEqual(variantWidthsFor(317), [317]);
});
