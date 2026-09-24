/**
 * The one way the editor draws a glyph of the icon set.
 *
 * The editor builds plain DOM and reads no React component, so it cannot
 * render an icon of `packages/ui/src/icons.tsx`. Every glyph it draws follows
 * the same grid there: the 24 viewport, the stroke of 1.5, and round ends,
 * as `packages/ui/src/icon-grid.ts` states. This module holds that grid once
 * for the editor. A shared geometry exported by `packages/ui` would remove the
 * second statement of the grid, and it needs a package entry of its own.
 */

/** The namespace of an SVG element. */
const svgNamespace = 'http://www.w3.org/2000/svg';

/** One path of a glyph, as the `d` of an SVG path, or the points of a line. */
export type GlyphPart =
  { readonly path: string } | { readonly polyline: string };

/** Draws one glyph of the icon grid, hidden from assistive software. */
export function glyph(
  className: string,
  parts: readonly GlyphPart[],
): SVGElement {
  const mark = document.createElementNS(svgNamespace, 'svg');
  mark.setAttribute('class', className);
  mark.setAttribute('viewBox', '0 0 24 24');
  mark.setAttribute('fill', 'none');
  mark.setAttribute('stroke', 'currentColor');
  mark.setAttribute('stroke-width', '1.5');
  mark.setAttribute('stroke-linecap', 'round');
  mark.setAttribute('stroke-linejoin', 'round');
  mark.setAttribute('aria-hidden', 'true');
  for (const part of parts) {
    const element =
      'path' in part
        ? document.createElementNS(svgNamespace, 'path')
        : document.createElementNS(svgNamespace, 'polyline');
    if ('path' in part) element.setAttribute('d', part.path);
    else element.setAttribute('points', part.polyline);
    mark.append(element);
  }
  return mark;
}
