/**
 * Keeps the frame on the part of the screen that a person sees.
 *
 * `lib/viewport-fit.ts` decides the height and whether the window stays at
 * the top. This hook reads `window.visualViewport`, writes the height to the
 * `--viewport-height` variable that the `h-viewport` step of
 * `tailwind.css` reads, and moves a window that iOS scrolled back to the top.
 * While the frame is on the screen, the document itself never scrolls and
 * never bounces: every page scrolls inside the frame.
 */
import { useEffect } from 'react';
import { viewportFit } from '../lib/viewport-fit.ts';

const heightVariable = '--viewport-height';
const pinnedClasses = ['overflow-hidden', 'overscroll-none'];

/** Fits the frame to the visual viewport while the frame is mounted. */
export function useViewportFit(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    root.classList.add(...pinnedClasses);
    document.body.classList.add(...pinnedClasses);
    const fit = (): void => {
      const next = viewportFit(
        viewport === null
          ? null
          : { height: viewport.height, scale: viewport.scale },
      );
      if (next.height === null) root.style.removeProperty(heightVariable);
      else root.style.setProperty(heightVariable, `${String(next.height)}px`);
      if (next.pinWindow && (window.scrollX !== 0 || window.scrollY !== 0))
        window.scrollTo(0, 0);
    };
    fit();
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    window.addEventListener('scroll', fit);
    return () => {
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      window.removeEventListener('scroll', fit);
      root.style.removeProperty(heightVariable);
      root.classList.remove(...pinnedClasses);
      document.body.classList.remove(...pinnedClasses);
    };
  }, []);
}
