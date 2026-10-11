/** Personal keys have a distinct prefix and 256 bits of random secret (0208). */
import { randomBytes } from 'node:crypto';

export function newApiKeySecret(): string {
  return `tnk_${randomBytes(32).toString('base64url')}`;
}

export function isApiKeySecret(value: string): boolean {
  return /^tnk_[A-Za-z0-9_-]{43}$/.test(value);
}
