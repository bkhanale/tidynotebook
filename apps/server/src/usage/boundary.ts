/**
 * The limits of each month at the response boundary (record 0193).
 *
 * The meter of `@notesapp/core` holds the sums and the rules. This module
 * puts it on the boundary of the server in two places:
 *
 * - **The gate.** Before the handler of an operation that a closure refuses
 *   runs, `checkUsageGate` reads the state of the account of the session, or
 *   of the installation for an upload, and answers `download_limit` or
 *   `storage_busy`. The one list of `usageGates` names each operation.
 * - **The count.** `countAnswer` is the last `onSend` hook of each contract
 *   route, after the compression of record 0169, so it counts the bytes that
 *   leave the server. The reader path counts for the owner of the
 *   workspace, which its handler names with `chargeReader`, and for the
 *   installation alone when no link opened. Every other answer to a session
 *   counts as a download of the account of that session. An answer to
 *   nobody else counts nothing.
 *
 * A `HEAD` answer sends no body and counts nothing.
 */
import { Buffer } from 'node:buffer';
import { pipeline, Transform, type Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  gateRefusal,
  secondsToNextMonth,
  usageGateOf,
  type UsageMeter,
} from '@notesapp/core';
import { requestActor } from '../auth/actor.ts';
import { publishedOriginOperations } from '../plugins/published-origin.ts';
import { DownloadLimitError, StorageBusyError } from '../plugins/problem.ts';

/** The owner of the workspace of each reader path answer that opened a link. */
const readerOwners = new WeakMap<FastifyRequest, string>();

/**
 * Names the account that the bytes of one reader path answer count for: the
 * owner of the workspace of the link. An answer that names none counts for
 * the installation only.
 */
export function chargeReader(
  request: FastifyRequest,
  accountId: string | null,
): void {
  if (accountId === null) readerOwners.delete(request);
  else readerOwners.set(request, accountId);
}

/** Whom the bytes of one answer count for, or `null` for nobody. */
export type AnswerSubject =
  | { readonly kind: 'published'; readonly accountId: string | null }
  | { readonly kind: 'download'; readonly accountId: string }
  | null;

/** Whom the bytes of one answer count for. */
export function answerSubject(request: FastifyRequest): AnswerSubject {
  const id = request.routeOptions.config.operationId;
  if (id !== undefined && publishedOriginOperations.has(id))
    return { kind: 'published', accountId: readerOwners.get(request) ?? null };
  const resolved = requestActor(request);
  if (resolved === undefined) return null;
  return { kind: 'download', accountId: resolved.actor.accountId };
}

/** Whether a payload is a stream that the framework pipes. */
function isStream(payload: unknown): payload is Readable {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'pipe' in payload &&
    typeof payload.pipe === 'function'
  );
}

/**
 * The bytes of a payload that the framework sends at once, or `null` for a
 * stream or for no body.
 */
export function payloadBytes(payload: unknown): number | null {
  if (typeof payload === 'string') return Buffer.byteLength(payload, 'utf8');
  if (payload instanceof Uint8Array) return payload.byteLength;
  return null;
}

/**
 * The same bytes as `source`, told to `count` as each chunk passes. A failure
 * of the source ends the copy with that failure, as the framework expects of
 * a body that fails.
 */
export function countedStream(
  source: Readable,
  count: (bytes: number) => void,
): Readable {
  const counted = new Transform({
    transform(chunk: unknown, _encoding, done) {
      const bytes = payloadBytes(chunk);
      if (bytes !== null) count(bytes);
      done(null, chunk);
    },
  });
  pipeline(source, counted, () => {
    // The copy ends with the failure of the source, and the framework
    // answers it. Nothing is left to do here.
  });
  return counted;
}

/** Builds the last `onSend` hook of each contract route. */
export function countAnswer(meter: UsageMeter) {
  return (
    request: FastifyRequest,
    _reply: FastifyReply,
    payload: unknown,
  ): Promise<unknown> => {
    if (request.method === 'HEAD') return Promise.resolve(payload);
    const subject = answerSubject(request);
    if (subject === null) return Promise.resolve(payload);
    const count =
      subject.kind === 'published'
        ? (bytes: number): void => {
            meter.countPublished(subject.accountId, bytes);
          }
        : (bytes: number): void => {
            meter.countDownload(subject.accountId, bytes);
          };
    if (isStream(payload))
      return Promise.resolve(countedStream(payload, count));
    const bytes = payloadBytes(payload);
    if (bytes !== null) count(bytes);
    return Promise.resolve(payload);
  };
}

/**
 * Refuses an operation that a closure of the month holds, before its handler
 * runs. The answer names the next month in UTC in `retry-after`.
 */
export async function checkUsageGate(
  meter: UsageMeter,
  clock: () => Date,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const id = request.routeOptions.config.operationId;
  const gate = id === undefined ? null : usageGateOf(id);
  if (gate === null) return;
  // An upload meets the caps of the installation only. Every other gate
  // meets the limits of the account of the session too.
  const resolved = requestActor(request);
  if (gate !== 'upload' && resolved === undefined) return;
  const state =
    gate === 'upload' || resolved === undefined
      ? await meter.installationState()
      : await meter.accountState(resolved.actor.accountId);
  const refusal = gateRefusal(gate, state);
  if (refusal === null) return;
  reply.header('retry-after', String(secondsToNextMonth(clock())));
  throw refusal === 'download_limit'
    ? new DownloadLimitError()
    : new StorageBusyError();
}
