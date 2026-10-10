/**
 * Third-party Windows distribution channels that must stay hidden until they
 * are actually live. Flip these after Partner Center / winget-pkgs accept the
 * package — never before.
 */
export const WINGET_PACKAGE_ID = 'VarveStudio.Varve';
export const WINGET_LIVE = false;

export const MICROSOFT_STORE_LIVE = false;
export const MICROSOFT_STORE_URL = '';

export function wingetInstallCommand(packageId = WINGET_PACKAGE_ID): string {
  return `winget install ${packageId}`;
}
