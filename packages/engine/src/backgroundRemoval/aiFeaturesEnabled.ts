/**
 * Read the user-facing AI master switch from editor settings.
 * Engine callers cannot import @varve/editor; the persisted key is the contract.
 */
export function getAiFeaturesEnabled(): boolean {
  try {
    const raw = localStorage.getItem('varve-editor-settings');
    if (!raw) return true;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const ai = parsed.ai as Record<string, unknown> | undefined;
    return ai?.enabled !== false;
  } catch {
    return true;
  }
}
