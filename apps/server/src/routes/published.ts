/**
 * The reader path of a published link.
 *
 * This file is the second refusal of decision 0031. It imports no actor
 * helper, so it holds no `Actor` and no write use case compiles in it. Every
 * operation it serves declares an empty security requirement, so the identity
 * hook of `plugins/register.ts` never runs for one.
 *
 * The publication store of plan 007 items 14 to 19 is not part of this build,
 * so no link record exists and every token is unknown. An unknown token takes
 * the one refusal of decision 0030, and that is the answer this file gives.
 * The answer does not change when the store lands: the resolve step, the scope
 * check and the reference check all grow in front of it, and each of them ends
 * in this same refusal.
 */
import { PublishedLinkUnavailableError } from '../plugins/problem.ts';
import type { HandlerMap, HandlerResult } from '../plugins/register.ts';

/**
 * The one refusal.
 *
 * One function serves all three operations, so no operation can drift into a
 * second answer.
 */
function refuse(): Promise<HandlerResult> {
  return Promise.reject(new PublishedLinkUnavailableError());
}

/** Builds the handlers of the reader path. */
export function createPublishedHandlers(): HandlerMap {
  return {
    getPublishedPage: refuse,
    unlockPublishedLink: refuse,
    getPublishedAttachment: refuse,
  };
}
