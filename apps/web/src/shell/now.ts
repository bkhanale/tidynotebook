/**
 * The instant that a screen reads while it draws.
 *
 * A screen that states a relative time built its phrase from one reading of
 * the clock. A screen that read the clock while it drew therefore kept the
 * phrase of the moment it opened, and a person who left the screen open read
 * `just now` an hour later. The clock is not part of the data of a screen, so
 * nothing else made the row draw again.
 *
 * This hook makes the instant a value of the screen. It reads the clock on a
 * fixed step, so every row that depends on it follows, and it reads the clock
 * again as soon as the tab comes back to the screen, because a browser slows
 * or stops a timer in a tab that nobody looks at. A screen therefore never
 * shows a phrase that the time it was away made false.
 */
import { useEffect, useState } from 'react';
import { relativeTimeStepMs } from '../lib/relative-time.ts';

/** The current instant, as a screen that states a relative time reads it. */
export function useNow(stepMs: number = relativeTimeStepMs): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const read = (): void => {
      setNow(Date.now());
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') read();
    };
    const step = window.setInterval(read, stepMs);
    document.addEventListener('visibilitychange', onVisible);
    read();
    return () => {
      window.clearInterval(step);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [stepMs]);
  return now;
}
