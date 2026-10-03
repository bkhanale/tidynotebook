/**
 * The window of one long list on the screen (record 0165).
 *
 * `lib/row-window.ts` decides which rows of a list the document holds. This
 * hook is the one place that measures what that rule reads and writes what it
 * answers: the stride of a rendered row, the place of the list in the box
 * that scrolls it, and the two paddings that stand for the rows outside the
 * window. A padding is a number that only the browser can measure, so it
 * cannot be a utility class, and no `style` attribute writes it: the hook
 * writes it through a reference after React commits the rows, as record 0058
 * writes the place of an overlay.
 *
 * The direct children of the list are its rows. The rows of one list share
 * one stride (record 0065), so one rendered row measures them all, and a
 * change of the pointer, which moves a row from 28 px to 44 px, measures them
 * again.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  firstStride,
  pinRow,
  revealScrollTop,
  rowWindow,
  sameRowWindow,
  type RowWindow,
} from '../lib/row-window.ts';

/** How many rows a window keeps on each side of the visible ones. */
export const defaultOverscan = 8;

/**
 * The stride that each kind of list measured last, in this session.
 *
 * A list that mounts again, such as All notes after a person opened a note,
 * starts at the stride it measured, so its first window holds the height of
 * every row and a kept scroll offset lands on the row the person left, under
 * touch as well as on a desktop.
 */
const measuredStrides = new Map<string, number>();

/** The height a list takes for its first window, before it measures one. */
const estimatedViewport = 1000;

/**
 * What a list reads from its window.
 *
 * A list renders the rows of `indexes` and no other range, so the row that it
 * keeps for the focus is always among the rows it renders.
 */
export type RowWindowControl = {
  /**
   * The indexes of the rendered rows in document order: the window, and the
   * kept row next to it when that row is outside the window.
   */
  readonly indexes: readonly number[];
  /** The list element. Its direct children are the rendered rows. */
  readonly listRef: (element: HTMLElement | null) => void;
  /** Scrolls the box that holds the list, so the row is in view. */
  readonly reveal: (index: number) => void;
};

/** The nearest ancestor that scrolls, which is where a list sits. */
export function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (
    let parent = element.parentElement;
    parent !== null;
    parent = parent.parentElement
  ) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return parent;
  }
  return null;
}

/** The distance from the top of one rendered row to the top of the next. */
function measuredStride(list: HTMLElement): number | null {
  const first = list.children.item(0);
  if (first === null) return null;
  const second = list.children.item(1);
  if (second !== null) {
    const stride =
      second.getBoundingClientRect().top - first.getBoundingClientRect().top;
    return stride > 0 ? stride : null;
  }
  const gap = Number.parseFloat(getComputedStyle(list).rowGap);
  const height = first.getBoundingClientRect().height;
  return height > 0 ? height + (Number.isFinite(gap) ? gap : 0) : null;
}

/** Keeps the rendered rows of one list to the window around the view. */
export function useRowWindow(
  count: number,
  kind: string,
  /** A row that stays in the document, such as the row with the focus. */
  pinned: number | null = null,
  overscan: number = defaultOverscan,
): RowWindowControl {
  const listRef = useRef<HTMLElement | null>(null);
  const strideRef = useRef(firstStride(measuredStrides.get(kind)));
  const countRef = useRef(count);
  countRef.current = count;
  const [rows, setRows] = useState<RowWindow>(() =>
    rowWindow({
      count,
      stride: strideRef.current,
      listTop: 0,
      viewportHeight: estimatedViewport,
      overscan,
    }),
  );

  /** Reads the place of the list and decides its window again. */
  const update = useCallback((): void => {
    const list = listRef.current;
    if (list === null) return;
    const scroller = scrollerOf(list);
    const stride = measuredStride(list);
    if (stride !== null) {
      strideRef.current = stride;
      measuredStrides.set(kind, stride);
    }
    const listTop =
      list.getBoundingClientRect().top -
      (scroller?.getBoundingClientRect().top ?? 0);
    const next = rowWindow({
      count: countRef.current,
      stride: strideRef.current,
      listTop,
      viewportHeight: scroller?.clientHeight ?? window.innerHeight,
      overscan,
    });
    setRows((current) => (sameRowWindow(current, next) ? current : next));
  }, [overscan, kind]);

  const attach = useCallback((element: HTMLElement | null): void => {
    listRef.current = element;
  }, []);

  // The paddings follow the rows that this commit rendered, so the rows and
  // the space that stands for the others change in one frame.
  const kept = pinRow(rows, pinned, count, strideRef.current);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    list.style.paddingTop = `${String(kept.before)}px`;
    list.style.paddingBottom = `${String(kept.after)}px`;
  }, [kept.before, kept.after]);

  // A new count, a new stride or a new place decides the window again.
  useLayoutEffect(() => {
    update();
  }, [count, update]);

  // A scroll, a new size of the box, or a new size of the screen moves the
  // view. One decision per frame is enough for any of them.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const scroller = scrollerOf(list);
    let frame: number | null = null;
    const schedule = (): void => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        update();
      });
    };
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    if (scroller !== null) observer.observe(scroller);
    const first = list.children.item(0);
    if (first !== null) observer.observe(first);
    return () => {
      target.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [update, rows.start]);

  const reveal = useCallback((index: number): void => {
    const list = listRef.current;
    if (list === null) return;
    const scroller = scrollerOf(list);
    if (scroller === null) return;
    const first = list.children.item(0);
    const next = revealScrollTop({
      index,
      stride: strideRef.current,
      // Row `index` starts this far below the top of the list, whether it
      // is rendered or stands inside the padding above the rendered rows.
      listOffset:
        list.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop,
      scrollTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight,
      rowHeight: first?.getBoundingClientRect().height ?? strideRef.current,
    });
    if (next !== null) scroller.scrollTop = next;
  }, []);

  return {
    indexes: kept.indexes,
    listRef: attach,
    reveal,
  };
}
