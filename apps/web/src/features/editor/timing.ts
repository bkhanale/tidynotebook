/**
 * Browser timing entries of the note screen.
 *
 * The note loader and the editor mark how long an open, a draft save and a
 * keystroke take, as development evidence in the User Timing buffer.
 */

/** Records a bounded browser timing entry without affecting the operation. */
export function recordTiming(name: string, startedAt: number): void {
  try {
    performance.measure(name, {
      start: startedAt,
      end: performance.now(),
    });
    if (performance.getEntriesByName(name).length > 200)
      performance.clearMeasures(name);
  } catch {
    // User Timing is development evidence only. It cannot break note work.
  }
}
