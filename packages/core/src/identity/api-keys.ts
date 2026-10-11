/** Personal credentials use the account transaction and current rights (0208). */
import { fail, ok, type Result } from '../files/model.ts';
import type { Actor } from './actor.ts';
import type { WorkspaceAdminStore } from '../workspaces/ports.ts';

export const maxApiKeys = 25;
export const defaultApiKeyDays = 90;
export const maxApiKeyDays = 365;
export const maxApiKeyNameLength = 80;

/** The public facts of one key. Neither a token nor a digest belongs here. */
export type ApiKeyRecord = {
  readonly keyId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
};

/** The secret is hashed before the storage port receives it. */
export type NewApiKey = {
  readonly keyId: string;
  readonly name: string;
  readonly tokenDigest: string;
  readonly expiresInDays: number;
};

export function apiKeyNameProblem(name: string): string | null {
  if (name.trim() === '') return 'Enter a name for the program.';
  if (Array.from(name).length > maxApiKeyNameLength)
    return 'Use no more than 80 characters for the name.';
  if (
    name !== name.trim() ||
    !name.isWellFormed() ||
    /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(name)
  )
    return 'Use a name with no space at either end or hidden characters.';
  return null;
}

export function apiKeyDaysHold(days: number): boolean {
  return Number.isInteger(days) && days >= 1 && days <= maxApiKeyDays;
}

export function listApiKeys(
  store: WorkspaceAdminStore,
  actor: Actor,
): Promise<Result<readonly ApiKeyRecord[]>> {
  return store.account(actor, async (tx) => ok(await tx.apiKeys()));
}

export function createApiKey(
  store: WorkspaceAdminStore,
  actor: Actor,
  input: NewApiKey,
): Promise<Result<ApiKeyRecord>> {
  if (
    apiKeyNameProblem(input.name) !== null ||
    !apiKeyDaysHold(input.expiresInDays) ||
    !/^[a-f0-9]{64}$/.test(input.tokenDigest)
  )
    return Promise.resolve(fail('forbidden'));
  return store.account(actor, async (tx) => {
    const key = await tx.createApiKey(input);
    return key === null ? fail('api_key_limit') : ok(key);
  });
}

export function revokeApiKey(
  store: WorkspaceAdminStore,
  actor: Actor,
  keyId: string,
): Promise<Result<void>> {
  return store.account(actor, async (tx) =>
    (await tx.revokeApiKey(keyId)) ? ok(undefined) : fail('not_found'),
  );
}

/** Both credentials change the profile through this same use case. */
export function updateProfile(
  store: WorkspaceAdminStore,
  actor: Actor,
  name: string,
): Promise<Result<void>> {
  if (
    name.trim() === '' ||
    name !== name.trim() ||
    Array.from(name).length > 256 ||
    !name.isWellFormed()
  )
    return Promise.resolve(fail('forbidden'));
  return store.account(actor, async (tx) => {
    await tx.setProfileName(name);
    return ok(undefined);
  });
}
