/**
 * The one refusal of the reader path, and the channel that keeps its cause.
 *
 * Decision 0030 states that a link that never existed, a revoked link, an
 * expired link and a wrong password give one answer. Decision 0031 makes the
 * reader path a closed boundary. This file makes the rule structural rather
 * than a habit:
 *
 * - There is one refusal value in the whole package. `publishedLinkUnavailable`
 *   is frozen, and `refuseRead` returns that one object every time, so two
 *   refusals of two different causes are the same value under `===`. A second
 *   refusal cannot appear by accident, because a second value would have to be
 *   written by hand here, and `errors.test.ts` compares the identity.
 * - The cause never travels with the refusal. It travels to a
 *   `ReaderRefusalLog`, whose one method answers nothing. A caller therefore
 *   holds no value that tells two causes apart, and a handler cannot put one
 *   in a body.
 * - The code is `published_link_unavailable`. It maps to the one problem
 *   shape of the contract, so even a handler that maps a domain failure in the
 *   general way answers the one refusal.
 *
 * This is the one place of the package that builds a `DomainError` without
 * `fail`. `fail` builds a new value for each call, and the whole rule here is
 * that every refusal is one value.
 */
import type { DomainError, Result } from '../files/model.ts';

/**
 * Why the reader path refused, for the operator only.
 *
 * The first four are the four causes of decision 0030. `out_of_scope` and
 * `no_reference` name the two refusals of a link that opens, which decision
 * 0031 holds to the same answer. `monthly_limit` names a link that opens
 * past a limit of the month of record 0193, which answers the closed page
 * too. A cause reaches the log module of decision 0020 and reaches no
 * response body.
 */
export const readerRefusalCauses = [
  'unknown',
  'revoked',
  'expired',
  'locked',
  'out_of_scope',
  'no_reference',
  'monthly_limit',
] as const;

/** One cause of a reader refusal. */
export type ReaderRefusalCause = (typeof readerRefusalCauses)[number];

/**
 * Where the cause of a refusal goes.
 *
 * The server passes an adapter over `packages/logging`. The method answers
 * nothing, so no use case can read the cause back and no answer can carry it.
 * A test passes a small collector and reads the causes it kept.
 */
export type ReaderRefusalLog = {
  record(cause: ReaderRefusalCause): void;
};

/**
 * The one failure value of the reader path.
 *
 * It is frozen and it is shared, so every refusal of this context is the same
 * object. It names no file, so it discloses nothing.
 */
export const publishedLinkUnavailable: DomainError = Object.freeze({
  code: 'published_link_unavailable',
  fileIds: Object.freeze([]),
});

/**
 * Refuses a read of the reader path and keeps the cause for the operator.
 *
 * Every refusal of this context goes through this one function, so no caller
 * decides how a refusal looks.
 */
export function refuseRead<T>(
  log: ReaderRefusalLog,
  cause: ReaderRefusalCause,
): Result<T> {
  log.record(cause);
  return { ok: false, error: publishedLinkUnavailable };
}
