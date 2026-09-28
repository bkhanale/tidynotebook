/**
 * The rules of a sync notice stream (records 0124 and 0129).
 *
 * A stream holds one subscription set at a time. A client replaces the whole
 * set with a newer generation, and the server accepts the set only when the
 * account may read every workspace of it. Before each outbound batch, the
 * server reads which workspaces the session may still read, drops every other
 * workspace from the set, and sends a notice for the changed workspaces that
 * remain. A notice asks for a feed read and carries nothing else, so these
 * rules decide only who hears of a change.
 */

/** The subscription set of one stream. */
export type NoticeSubscription = {
  /** The generation of the set, or 0 before the first set. */
  readonly generation: number;
  readonly workspaceIds: ReadonlySet<string>;
};

/** A stream before its first set, which hears of nothing. */
export const emptySubscription: NoticeSubscription = {
  generation: 0,
  workspaceIds: new Set(),
};

/** Why a new set is refused. The set before it stays in force. */
export type SubscriptionRefusal = 'stale_generation' | 'forbidden';

/**
 * Replaces the set of a stream with a requested one.
 *
 * `readable` is every workspace that the session may read now. A generation
 * that is not above the current one is refused first, so a late message of an
 * older set cannot replace a newer set. A set that names one workspace
 * outside `readable` is refused as a whole.
 */
export function replaceSubscription(
  current: NoticeSubscription,
  request: {
    readonly generation: number;
    readonly workspaceIds: readonly string[];
  },
  readable: readonly string[],
):
  | { readonly ok: true; readonly subscription: NoticeSubscription }
  | { readonly ok: false; readonly reason: SubscriptionRefusal } {
  if (request.generation <= current.generation)
    return { ok: false, reason: 'stale_generation' };
  const allowed = new Set(readable);
  if (request.workspaceIds.some((id) => !allowed.has(id)))
    return { ok: false, reason: 'forbidden' };
  return {
    ok: true,
    subscription: {
      generation: request.generation,
      workspaceIds: new Set(request.workspaceIds),
    },
  };
}

/**
 * Decides one outbound batch of a stream.
 *
 * `changed` holds the workspaces whose feed changed since the last batch, and
 * `readable` every workspace that the session may read now. A workspace of the
 * set that is no longer readable leaves the set, and no notice names it. The
 * notices go to the changed workspaces that stay in the set, in a stable order.
 */
export function noticeBatch(
  subscription: NoticeSubscription,
  changed: ReadonlySet<string>,
  readable: readonly string[],
): {
  readonly subscription: NoticeSubscription;
  readonly notify: readonly string[];
} {
  const allowed = new Set(readable);
  const kept = [...subscription.workspaceIds].filter((id) => allowed.has(id));
  const next: NoticeSubscription =
    kept.length === subscription.workspaceIds.size
      ? subscription
      : { generation: subscription.generation, workspaceIds: new Set(kept) };
  return {
    subscription: next,
    notify: kept.filter((id) => changed.has(id)).sort(),
  };
}
