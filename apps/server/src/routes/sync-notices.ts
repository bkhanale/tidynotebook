/**
 * The upgrade route of the sync notice stream (records 0124 and 0126).
 *
 * The contract names the upgrade operation with a protocol marker, so the
 * startup check proves that this server serves the address of the channel.
 * Notices stay off until plan 016 turns them on, so this adapter answers every
 * upgrade with `notices_unavailable`, and the client reads the feed on its
 * own schedule. The request is validated against the contract before this
 * adapter runs, so a request without the subprotocol answers 400.
 */
import { findChannel } from '@notesapp/api-contract';
import type { ProtocolAdapter, ProtocolResult } from '../plugins/register.ts';
import { createProblem } from '../plugins/problem.ts';

/** Value of the protocol marker of the upgrade operation. */
export const syncNoticesProtocol = 'sync-notices';

/** Builds the adapter that serves the upgrade address of the channel. */
export function createSyncNoticesProtocol(): ProtocolAdapter {
  const channel = findChannel('syncNotices');
  if (channel === undefined)
    throw new Error('The contract has no syncNotices channel.');
  return {
    protocol: syncNoticesProtocol,
    routes: [{ method: 'GET', path: channel.address }],
    handle: (request): Promise<ProtocolResult> =>
      Promise.resolve({
        status: 503,
        mediaType: 'application/problem+json',
        headers: [],
        cookies: [],
        body: createProblem({
          code: 'notices_unavailable',
          status: 503,
          detail:
            'The notice stream is off. Read the feed on your own schedule.',
          instance: channel.address,
          requestId: request.id,
        }),
        bytes: null,
      }),
  };
}
