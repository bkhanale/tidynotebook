/**
 * The bounds of the sync notice gateway (record 0129).
 *
 * Each value is an implementation bound to measure in the rollout of plan
 * 016, not a promise of capacity. A breach of a bound stops the stream, and
 * the client reads the feed on its own schedule until it opens a new one.
 */

/** The bounds of one gateway. A test passes shorter times. */
export type NoticeBounds = {
  /** The largest client frame in bytes. The library closes a larger one. */
  readonly maxFrameBytes: number;
  /** The client messages that one stream may send in one window. */
  readonly messagesPerWindow: number;
  /** The window of that count, in milliseconds. */
  readonly messageWindowMs: number;
  /** The bytes that may wait to be written before the stream stops. */
  readonly maxBufferedBytes: number;
  /** The interval of the protocol Ping. A stream without a Pong stops. */
  readonly heartbeatMs: number;
  /** The interval of the access check of an idle stream. */
  readonly accessCheckMs: number;
  /** The life of a stream reservation, which the gateway renews. */
  readonly reservationTtlMs: number;
  /** The interval of that renewal. */
  readonly reservationRenewMs: number;
  /** The time an admitted upgrade has to open its socket. */
  readonly openDeadlineMs: number;
  /** The listener gap that ends with `reconcile` and not with a stop. */
  readonly listenerGraceMs: number;
  /** The streams of one account across every process. */
  readonly streamsPerAccount: number;
  /** The streams of this process. */
  readonly streamsPerProcess: number;
  /** The time the drain waits for a stream to close before it ends it. */
  readonly drainMs: number;
};

export const defaultNoticeBounds: NoticeBounds = {
  // A subscription set holds at most 1000 identifiers of 36 characters, which
  // the largest valid frame test holds under this bound.
  maxFrameBytes: 64 * 1024,
  messagesPerWindow: 20,
  messageWindowMs: 60_000,
  maxBufferedBytes: 64 * 1024,
  heartbeatMs: 30_000,
  accessCheckMs: 60_000,
  reservationTtlMs: 90_000,
  reservationRenewMs: 30_000,
  openDeadlineMs: 10_000,
  listenerGraceMs: 10_000,
  streamsPerAccount: 8,
  streamsPerProcess: 5_000,
  drainMs: 5_000,
};
