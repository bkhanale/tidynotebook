/**
 * How the frame fits the part of the screen that a person sees.
 *
 * Safari on iOS keeps the layout viewport at the full height of the screen
 * when the keyboard opens, and only the visual viewport shrinks. The frame
 * was as tall as the layout viewport, so the page could scroll under the
 * keyboard: a drag on the header moved the whole frame up and left empty
 * space under it. The frame takes the height of the visual viewport instead,
 * and the window stays at the top, so there is nothing to scroll.
 *
 * A person who zooms in moves the visual viewport on purpose, so a zoomed
 * page keeps the default height and is free to move.
 */

/** The facts of `window.visualViewport` that the fit reads. */
export type VisualViewportFacts = {
  readonly height: number;
  readonly scale: number;
};

/** The height of the frame in pixels, and whether the window stays at 0. */
export type ViewportFit = {
  /** `null` keeps the default height of the frame, the dynamic viewport. */
  readonly height: number | null;
  readonly pinWindow: boolean;
};

/** A zoom within this distance of 1 is no zoom. */
const unzoomed = 0.01;

/** The fit for one state of the visual viewport. */
export function viewportFit(viewport: VisualViewportFacts | null): ViewportFit {
  if (viewport === null || !(viewport.height > 0))
    return { height: null, pinWindow: false };
  if (Math.abs(viewport.scale - 1) > unzoomed)
    return { height: null, pinWindow: false };
  return { height: Math.round(viewport.height), pinWindow: true };
}
