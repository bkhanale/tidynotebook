/** The key facts a person needs, with no identifier or stored secret (0208). */
import type { ApiKey } from '@notesapp/api-client';
import { relativeTime } from './relative-time.ts';

export const apiKeyExpiryChoices = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
] as const;

export function apiKeyFacts(key: ApiKey, now: number): string {
  const expiry =
    Date.parse(key.expiresAt) <= now
      ? 'Expired'
      : `Expires ${relativeTime(key.expiresAt, now)}`;
  const use =
    key.lastUsedAt === null
      ? 'Not used yet'
      : `Last used ${relativeTime(key.lastUsedAt, now)}`;
  return `${expiry}. ${use}.`;
}

export function apiKeyRevokeText(name: string): string {
  return `The program that uses ${name} loses access at once. You can create a new key later.`;
}
