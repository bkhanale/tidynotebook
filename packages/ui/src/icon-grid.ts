/**
 * The one grid of every icon of the product.
 *
 * `icons.tsx` is JSX, so no unit test can load it. The grid is not JSX, so it
 * lives here and `icons.test.ts` reads it: one 24 by 24 viewport, one stroke
 * of 1.5, and two rendered sizes. An icon set with one stroke and six sizes
 * draws the same glyph as a hairline in a row and as a heavy mark in an empty
 * state, which is the fault decision 0065 answers.
 *
 * See
 * [decision 0065](../../../docs/decisions/0065-one-recipe-for-a-control-and-one-grid-for-an-icon.md).
 */

/** The drawing grid and the two sizes an icon renders at. */
export const iconGrid = {
  viewBox: '0 0 24 24',
  strokeWidth: 1.5,
  /** 16 px in a control, a row and a label. 20 px in an empty state. */
  sizes: [16, 20],
} as const;

/** The size an icon takes when a caller states none. */
export const defaultIconSize = 16;

/**
 * The SVG attributes that every icon of the set shares.
 *
 * One object, spread by one frame component, so no icon can state a stroke or
 * a viewport of its own and `icons.test.ts` proves that none of them does.
 * An icon inherits the text colour of its parent and hides from assistive
 * software, because the control around it carries the name.
 */
export const iconAttributes = {
  viewBox: iconGrid.viewBox,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: iconGrid.strokeWidth,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
} as const;
