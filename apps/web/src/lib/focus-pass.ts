/**
 * The bound of a sync pass that a return to the window asks for.
 *
 * A person who comes back to the application expects it to catch up, so the
 * tab asks the sync engine for a pass when the window takes focus and when the
 * tab becomes visible again. Both events arrive as often as a person switches
 * windows, and a browser sends both of them for one return, so an unbounded
 * ask turns a slow move between two windows into a pass for every move.
 *
 * The quiet period is the one in `./revalidate.ts`, which already bounds the
 * background read of the note list, so a return to the window costs one server
 * conversation and not two rules.
 *
 * A return inside the quiet period is dropped and not delayed, which is the
 * one difference from the file list. The engine keeps its own safety interval
 * and runs a pass on its own, so a dropped ask costs a short wait and never
 * leaves the device behind. A dropped read of the file list would have no such
 * safety net, which is why that caller waits instead.
 */
import { revalidateIntervalMs, shouldRevalidate } from './revalidate.ts';

/** The bound of one tab, which holds when its last pass was asked for. */
export type FocusPass = {
  /**
   * Whether a return to the window may ask for a pass at this instant.
   *
   * A true answer counts as the pass, so two returns inside one quiet period
   * answer true once. A clock that moves backwards releases the period, the
   * way the file list treats a device clock that a person changed.
   */
  ask(now: number): boolean;
};

/** Builds the bound of one tab. */
export function createFocusPass(
  intervalMs: number = revalidateIntervalMs,
): FocusPass {
  let lastAt: number | null = null;
  return {
    ask(now: number): boolean {
      if (!shouldRevalidate(lastAt, now, intervalMs)) return false;
      lastAt = now;
      return true;
    },
  };
}
