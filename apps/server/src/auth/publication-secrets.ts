/**
 * The two secret rules of a published link, as this deployment implements them.
 *
 * Decision 0030 states both and `packages/core` declares both as ports, so the
 * domain names no library and no parameter of one. This file is where the
 * platform answers.
 *
 * **The token and the ticket are drawn, not derived.** `newPublishedSecret`
 * takes 32 bytes from the system source and writes them in the URL safe
 * alphabet, so the value carries full entropy and travels in an address
 * unchanged. The stored value is `secretDigest`, one SHA-256 in lower case
 * hexadecimal: the lookup of a link is an index read of that column, which a
 * slow salted hash could not serve, and a read of the database yields no
 * working link because a digest opens nothing.
 *
 * **The password is hashed by the account path.** A password carries no
 * entropy that a digest could trust, so it takes the slow salted hasher that
 * `cli/recover-account.ts` already reaches through the Better Auth context.
 * The product keeps one hashing scheme, so a later library move breaks this
 * one adapter and `tests/integration/publication-hasher.test.ts` fails with it.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { PasswordHasher, SecretDigest } from '@notesapp/core';
import type { NotesappAuth } from './better-auth.ts';

/** How many bytes one drawn reader secret carries. */
const secretBytes = 32;

/**
 * One opaque reader secret, in the shape that an address carries.
 *
 * The answer is the value that the owner copies once, or the ticket that an
 * unlock answers once. No caller stores it: the caller stores its digest.
 */
export function newPublishedSecret(): string {
  return randomBytes(secretBytes).toString('base64url');
}

/**
 * The digest rule of the reader path.
 *
 * It is deterministic for the life of a record, which is what the port asks:
 * one secret gives one digest, so the index read of a link keeps working.
 */
export const secretDigest: SecretDigest = {
  digest(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  },
};

/**
 * The password rule of a published link, over the Better Auth context.
 *
 * The context owns the parameters of the hash. This adapter states none of
 * them, so the account password and the password of a link are hashed by one
 * scheme and a change of that scheme moves both at once.
 */
export function createPublicationHasher(auth: NotesappAuth): PasswordHasher {
  return {
    async hash(password: string): Promise<string> {
      const context = await auth.$context;
      return context.password.hash(password);
    },
    async verify(digest: string, password: string): Promise<boolean> {
      const context = await auth.$context;
      return context.password.verify({ hash: digest, password });
    },
  };
}
