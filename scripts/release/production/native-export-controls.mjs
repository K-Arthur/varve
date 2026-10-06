import assert from 'node:assert/strict';

// Installed builds save through the native destination picker. Their quick
// export action is explicitly named Export; Download belongs to the web app.
export function nativeQuickExportControls(format) {
  assert.ok(['PNG', 'SVG', 'PDF'].includes(format), 'Qualified native export format required');
  return [
    { role: 'radio', name: format },
    ...(format === 'PNG' ? [{ role: 'radio', name: '1x' }] : []),
    { role: 'button', name: `Export ${format}` },
  ];
}

export async function clickNativeQuickExport(page, format) {
  for (const { role, name } of nativeQuickExportControls(format))
    await page.getByRole(role, { name, exact: true }).click();
}
