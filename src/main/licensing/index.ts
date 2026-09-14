// Licensing seam. The only module the rest of the app may import for licensing.
// No network, no keys, no persistence until the owner approves an approach.
export type LicenseTier = 'free';
export interface LicenseStatus { tier: LicenseTier }
export function getLicenseStatus(): LicenseStatus {
  return { tier: 'free' };
}
