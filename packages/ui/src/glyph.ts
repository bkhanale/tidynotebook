/**
 * The glyphs of the icon set that plain DOM draws.
 *
 * The editor builds its own DOM, and the script of a published page runs with
 * no React, so neither can render a component of `./icons.tsx`. Both draw the
 * glyphs they need here, on the one grid of `./icon-grid.ts` and with its
 * shared attributes, so a glyph of a plain DOM control is the glyph of the
 * same action everywhere else. `./glyph-parts.ts` holds the parts of each
 * glyph.
 *
 * See
 * [decision 0065](../../../docs/decisions/0065-one-recipe-for-a-control-and-one-grid-for-an-icon.md).
 */
import type { GlyphPart } from './glyph-parts.ts';
import { iconAttributes } from './icon-grid.ts';

/** The namespace of an SVG element. */
const svgNamespace = 'http://www.w3.org/2000/svg';

/** Each shared attribute of the grid, with the name SVG gives it. */
const sharedAttributes: readonly (readonly [
  keyof typeof iconAttributes,
  string,
])[] = [
  ['viewBox', 'viewBox'],
  ['fill', 'fill'],
  ['stroke', 'stroke'],
  ['strokeWidth', 'stroke-width'],
  ['strokeLinecap', 'stroke-linecap'],
  ['strokeLinejoin', 'stroke-linejoin'],
  ['aria-hidden', 'aria-hidden'],
];

/** The attributes of one part, as SVG writes them. */
function partAttributes(part: GlyphPart): readonly (readonly [string, string])[] {
  switch (part.kind) {
    case 'path':
      return [['d', part.d]];
    case 'polyline':
      return [['points', part.points]];
    case 'line':
      return [
        ['x1', String(part.x1)],
        ['y1', String(part.y1)],
        ['x2', String(part.x2)],
        ['y2', String(part.y2)],
      ];
    case 'rect':
      return [
        ['x', String(part.x)],
        ['y', String(part.y)],
        ['width', String(part.width)],
        ['height', String(part.height)],
        ['rx', String(part.rx)],
        ['ry', String(part.rx)],
      ];
    case 'circle':
      return [
        ['cx', String(part.cx)],
        ['cy', String(part.cy)],
        ['r', String(part.r)],
      ];
  }
}

/**
 * Draws one glyph in a document, hidden from assistive software.
 *
 * The control around the glyph carries the name, as it does for an icon of
 * the set. `className` sets the size and the place of the glyph.
 */
export function glyph(
  className: string,
  parts: readonly GlyphPart[],
  owner: Document = document,
): SVGElement {
  const mark = owner.createElementNS(svgNamespace, 'svg');
  mark.setAttribute('class', className);
  for (const [key, name] of sharedAttributes)
    mark.setAttribute(name, String(iconAttributes[key]));
  for (const part of parts) {
    const element = owner.createElementNS(svgNamespace, part.kind);
    for (const [name, value] of partAttributes(part))
      element.setAttribute(name, value);
    mark.append(element);
  }
  return mark;
}
