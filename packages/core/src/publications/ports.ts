/**
 * The ports of the publications context.
 *
 * Every method here reads. There is no write method, which is refusal 3 of
 * decision 0031: a reader path that wanted to write would have nothing to
 * call. The owner path writes a link through the storage package, outside
 * this port, so this interface stays the read boundary of a stranger.
 *
 * No method takes an `Actor` and no method takes an account, because a reader
 * has none. The token that a reader carries is never a member of a record;
 * the caller gives its digest, and the storage layer looks the digest up
 * through its index.
 *
 * The refusal channel is not here. It sits with the one refusal value in
 * `errors.ts`, so the whole shape of a refusal is in one file.
 */
import type {
  PublishedLink,
  PublishedNote,
  PublishedNoteContent,
  ReadingTicket,
} from './model.ts';
import type { ReaderRefusalLog } from './errors.ts';

/**
 * Milliseconds since the Unix epoch.
 *
 * The runtime passes `Date.now`. A use case calls it once for one request, so
 * every rule of that request reads one instant, and a test passes a clock that
 * it moves by hand.
 */
export type Clock = () => number;

/**
 * The digest rule of a reader secret.
 *
 * A token and a ticket each hold full entropy, so the stored value is a fast
 * one way digest and not a password hash, as decision 0030 states. The lookup
 * of a link is an index read of that digest, which a slow salted hash could
 * not serve.
 *
 * `packages/core` computes no digest, because it imports no Node module and no
 * library. The adapter in `apps/server` implements this port over the hash of
 * the platform, and it must stay deterministic: one secret gives one digest
 * for the life of a record.
 */
export type SecretDigest = {
  /** The stored digest of one full entropy secret. */
  digest(secret: string): string;
};

/**
 * The password rule of a link.
 *
 * A password holds no entropy that a digest could trust, so it takes the slow
 * salted hasher of the account path. Decision 0030 keeps one hashing scheme in
 * the product: the adapter of `apps/server` implements this port over the
 * Better Auth context that `cli/recover-account.ts` already reaches.
 * `packages/core` imports no hashing library and holds no parameter of one.
 */
export type PasswordHasher = {
  hash(password: string): Promise<string>;
  /** True when the password matches the stored value. */
  verify(digest: string, password: string): Promise<boolean>;
};

/**
 * The reads of one open publication transaction.
 *
 * Every method after the first takes the link, so the storage layer bounds
 * each query by that one record. Decision 0030 puts the scope in the SQL for
 * that reason. The domain checks the scope again on every note it receives,
 * so a query that forgets the bound still opens nothing.
 */
export type PublicationReader = {
  /** The link of one token digest, or `null` when no record holds it. */
  linkByTokenDigest(tokenDigest: string): Promise<PublishedLink | null>;
  /** The ticket of one digest inside this link, or `null`. */
  ticketOfLink(
    link: PublishedLink,
    ticketDigest: string,
  ): Promise<ReadingTicket | null>;
  /** One note of the scope of this link with its current Markdown, or `null`. */
  noteOfLink(
    link: PublishedLink,
    fileId: string,
  ): Promise<PublishedNoteContent | null>;
  /** The live notes of the scope of this link, up to `limit` of them. */
  notesOfLink(
    link: PublishedLink,
    limit: number,
  ): Promise<readonly PublishedNote[]>;
  /**
   * The attachment revisions that the current head of this note names.
   *
   * The answer states what the stored Markdown references now. A revision that
   * only an older head named is not in it, so a reader cannot hold an address
   * that the note dropped.
   */
  attachmentsOfNote(
    link: PublishedLink,
    note: PublishedNote,
  ): Promise<readonly string[]>;
};

/** Opens one read-only publication transaction. */
export type PublicationStore = {
  /**
   * Runs `run` inside one read-only transaction and answers its value.
   *
   * The transaction takes no workspace lock and holds no actor. The storage
   * layer marks it read only, which is refusal 4 of decision 0031.
   */
  read<T>(run: (reader: PublicationReader) => Promise<T>): Promise<T>;
};

/**
 * What every use case of the reader path needs.
 *
 * One value carries the three, so a new use case cannot forget the refusal
 * log and cannot read the system clock by itself. The context holds no actor,
 * no account and no write port.
 */
export type PublicationContext = {
  readonly store: PublicationStore;
  readonly clock: Clock;
  readonly refusals: ReaderRefusalLog;
};
