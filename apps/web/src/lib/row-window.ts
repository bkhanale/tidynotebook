/**
 * Which rows of a long list are in the document (record 0165).
 *
 * A list of a thousand notes is ten thousand elements, and a person sees
 * twenty-five rows of it. A list therefore renders the rows in view and a few
 * on each side, and keeps the height of the others as padding above and below
 * the rows it renders, so the scroll bar, the scroll offset and the place of
 * every row stay what they would be with every row in the document.
 *
 * The rows of one list share one stride, the distance from the top of a row
 * to the top of the next, because every row of the product is one recipe
 * (record 0065). The rule is arithmetic over that stride, the place of the
 * list in its scroller and the height of the scroller. It is pure, so
 * `row-window.test.ts` states every edge. `shell/row-window.ts` is the one
 * hook that measures the numbers and writes the two paddings.
 */

/** What the rule reads about one list and the box that scrolls it. */
export type RowWindowInput = {
  /** How many rows the list holds. */
  readonly count: number;
  /** The distance from the top of one row to the top of the next, in px. */
  readonly stride: number;
  /**
   * The top of the list below the top of the visible part of its scroller,
   * in px. It is negative once the list starts above the visible part.
   */
  readonly listTop: number;
  /** The height of the visible part of the scroller, in px. */
  readonly viewportHeight: number;
  /** How many rows to keep on each side of the visible ones. */
  readonly overscan: number;
};

/** The rows a list renders and the space that stands for the others. */
export type RowWindow = {
  /** The first rendered row. */
  readonly start: number;
  /** One past the last rendered row. */
  readonly end: number;
  /** The space above the first rendered row, in px. */
  readonly before: number;
  /** The space below the last rendered row, in px. */
  readonly after: number;
};

/** A list with no row, which renders nothing and holds no space. */
export const emptyRowWindow: RowWindow = {
  start: 0,
  end: 0,
  before: 0,
  after: 0,
};

/** Holds a value between two bounds. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * The rows of one list that the document holds.
 *
 * The rows that meet the visible part of the scroller are rendered, and
 * `overscan` rows on each side, so a short scroll or a move of the focus to
 * the next row finds that row in place. A list that lies wholly outside the
 * visible part renders its `overscan` rows nearest to it. A stride that is
 * not a positive number renders every row, because no space can stand for a
 * row whose height nobody knows.
 */
export function rowWindow(input: RowWindowInput): RowWindow {
  const count = Math.max(0, Math.floor(input.count));
  if (count === 0) return emptyRowWindow;
  const overscan = Math.max(0, Math.floor(input.overscan));
  if (!Number.isFinite(input.stride) || input.stride <= 0)
    return { start: 0, end: count, before: 0, after: 0 };
  const stride = input.stride;
  const firstVisible = Math.floor(Math.max(0, -input.listTop) / stride);
  const lastVisible = Math.ceil(
    Math.max(0, input.viewportHeight - input.listTop) / stride,
  );
  const start = clamp(firstVisible - overscan, 0, count);
  const end = clamp(
    Math.max(lastVisible, firstVisible) + overscan,
    start,
    count,
  );
  // A list wholly below the visible part keeps its first rows, and a list
  // wholly above it keeps its last rows, so a step into it finds a row.
  const window =
    start === end
      ? lastVisible <= 0
        ? { start: 0, end: Math.min(count, overscan) }
        : { start: Math.max(0, count - overscan), end: count }
      : { start, end };
  return {
    start: window.start,
    end: window.end,
    before: window.start * stride,
    after: (count - window.end) * stride,
  };
}

/** Whether two windows render the same rows with the same space. */
export function sameRowWindow(left: RowWindow, right: RowWindow): boolean {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.before === right.before &&
    left.after === right.after
  );
}

/** What the rule reads to bring one row into view. */
export type RevealInput = {
  readonly index: number;
  readonly stride: number;
  /** The top of the list below the top of the content of the scroller. */
  readonly listOffset: number;
  /** How far the scroller has scrolled, in px. */
  readonly scrollTop: number;
  readonly viewportHeight: number;
  /** The height of one row without the gap after it, in px. */
  readonly rowHeight: number;
};

/**
 * The scroll offset that brings one row into view, or `null` when it is in
 * view already.
 *
 * The scroller moves the least distance that shows the whole row, as
 * `scrollIntoView` with `block: 'nearest'` does, which a row that is not in
 * the document cannot ask for itself.
 */
export function revealScrollTop(input: RevealInput): number | null {
  const top = input.listOffset + input.index * input.stride;
  const bottom = top + input.rowHeight;
  if (top < input.scrollTop) return Math.max(0, top);
  if (bottom > input.scrollTop + input.viewportHeight)
    return Math.max(0, bottom - input.viewportHeight);
  return null;
}

/**
 * The stride a list takes before it measures one of its rows.
 *
 * A row is 28 px on a desktop with a gap of a few pixels, so the first
 * window of a list that never measured holds about as many rows as the
 * screen shows.
 */
export const estimatedStride = 32;

/**
 * The stride of the first window of a list: the stride that a list of its
 * kind measured last, or the estimate.
 *
 * The first window states the height of every row. A list that mounts again
 * with the estimate states a height that a touch screen, whose rows are
 * 44 px, does not have, and a kept scroll offset lands short of the row a
 * person left.
 */
export function firstStride(remembered: number | undefined): number {
  return remembered !== undefined &&
    Number.isFinite(remembered) &&
    remembered > 0
    ? remembered
    : estimatedStride;
}

/** The rows a list renders, with one row kept, and the space around them. */
export type PinnedWindow = {
  /** The indexes of the rendered rows, in the order of the document. */
  readonly indexes: readonly number[];
  readonly before: number;
  readonly after: number;
};

/**
 * The window of a list that also keeps one row in the document.
 *
 * The row that has the focus stays in the document when a person scrolls it
 * out of the window, because a focused element that leaves the document
 * sends the focus to the page (record 0165). The kept row stands next to the
 * window, on the side of its place, and one stride of space less stands for
 * the rows on that side, so the height of the list stays the same. It is out
 * of view there, by the overscan, until the window reaches its place.
 */
export function pinRow(
  window: RowWindow,
  pinned: number | null,
  count: number,
  stride: number,
): PinnedWindow {
  const rendered = Array.from(
    { length: window.end - window.start },
    (_unused, offset) => window.start + offset,
  );
  if (pinned === null || pinned < 0 || pinned >= count)
    return { indexes: rendered, before: window.before, after: window.after };
  if (pinned < window.start)
    return {
      indexes: [pinned, ...rendered],
      before: Math.max(0, window.before - stride),
      after: window.after,
    };
  if (pinned >= window.end)
    return {
      indexes: [...rendered, pinned],
      before: window.before,
      after: Math.max(0, window.after - stride),
    };
  return { indexes: rendered, before: window.before, after: window.after };
}
