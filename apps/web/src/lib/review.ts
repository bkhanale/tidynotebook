/**
 * What Review offers for one note, and the words it uses (record 0087).
 *
 * A normal merge never waits for a person. The work of both devices is in the
 * note already, so Review only shows what changed: the exact text that this
 * device sent, beside the note now. The store keeps that text with the event,
 * so a later draft or a later save can never become the base.
 *
 * A note offers the oldest Review that waits, one at a time. Opening the
 * Review or dismissing the notice clears that one event on this device only,
 * and the next one, or a later merge, can offer Review again.
 *
 * An upgrade that could not place earlier work kept it in Needs attention.
 * The Review of that event compares the kept text with the note, and its one
 * action opens Needs attention, where the text waits for the person.
 *
 * Every sentence comes from here, so no screen shows an identifier or an
 * engine word, and one cause has one message.
 */
import type { ReviewRecord } from '@notesapp/sync';

/** The notice that the note shows while a Review waits. */
export type ReviewNotice = {
  /** The event that the notice opens or dismisses. */
  readonly reviewId: string;
  readonly message: string;
};

/**
 * The notice of the Review that the note offers, or `null` for none.
 *
 * `reviews` is the list of the store, which reads oldest first, so the first
 * event is the one that waited longest.
 */
export function reviewNotice(
  reviews: readonly ReviewRecord[],
): ReviewNotice | null {
  const first = reviews[0];
  if (first === undefined) return null;
  return {
    reviewId: first.reviewId,
    message:
      first.cause.kind === 'merge'
        ? 'This note has changes from another device.'
        : 'Earlier work on this device did not go into this note. Needs attention keeps it.',
  };
}

/** Everything the Review screen says about one event. */
export type ReviewPage = {
  readonly title: string;
  readonly description: string;
  /** The label of the kept text in the comparison. */
  readonly keptLabel: string;
  /** The label of the current text in the comparison. */
  readonly currentLabel: string;
  /** What the comparison says when the two texts are the same. */
  readonly sameText: string;
  /** Why no comparison shows, or `null` when the kept text is here. */
  readonly missing: string | null;
  /** True when the one action of the screen opens Needs attention. */
  readonly opensAttention: boolean;
};

/** The words of the Review screen for one event. */
export function reviewPage(review: ReviewRecord): ReviewPage {
  if (review.cause.kind === 'merge')
    return {
      title: 'Changes from another device',
      description:
        'Your save went into the note together with changes from another device. The lines below compare your save with the note now.',
      keptLabel: 'Your save',
      currentLabel: 'The note now',
      sameText: 'The note holds the same text as your save.',
      missing:
        review.text === null
          ? 'The text of your save is not on this device any more.'
          : null,
      opensAttention: false,
    };
  return {
    title: 'Earlier work on this device',
    description:
      'This work did not go into the note when Notesapp was updated. The lines below compare it with the note now. Needs attention keeps the text until you act on it.',
    keptLabel: 'Earlier work',
    currentLabel: 'The note now',
    sameText: 'The note holds the same text as the earlier work.',
    missing:
      review.text === null
        ? 'The earlier work is not on this device any more.'
        : null,
    opensAttention: true,
  };
}

/** What the screen shows when no Review waits for the note. */
export const noReviewTitle = 'Nothing to review';

/** The sentence under that title. */
export const noReviewDescription =
  'No change from another device waits for review on this device.';

/** What the Review screen says when the store could not be read. */
export const reviewReadFailed =
  'The review could not be read on this device. Try again.';

/** What the Review screen says when the comparison ran out of budget. */
export const reviewTooFarApart =
  'The two texts are too far apart to compare line by line.';

/** What the notice says when the dismissal did not reach the store. */
export const reviewDismissFailed = 'The notice did not close. Try again.';
