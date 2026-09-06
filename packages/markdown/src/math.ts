/**
 * Sanitized KaTeX rendering of stored math.
 *
 * The Markdown parser reports `inlineMath` and `math` nodes with their source.
 * This module turns that source into HTML that the renderer can embed. It uses
 * KaTeX directly rather than through a rehype plugin, because the pinned
 * rehype plugin still selects an older KaTeX release. The HTML it returns is
 * already sanitized, so the renderer inserts it after its own sanitizer ran.
 *
 * What this module never does:
 *
 * - It never trusts the source. KaTeX runs with `trust: false`, so `\href`,
 *   `\includegraphics`, `\htmlData`, and similar commands render as red text
 *   rather than as links or markup. `strict: 'error'` refuses LaTeX
 *   incompatible input instead of warning through the console.
 * - It never renders unbounded work. The source length, the macro count, the
 *   KaTeX `maxSize`, and the KaTeX `maxExpand` are all capped. A document that
 *   exceeds them throws `MathRenderError` and the caller keeps editable source.
 * - It never returns raw KaTeX output. The sanitizer below keeps only `span`
 *   elements with KaTeX classes, `aria-hidden`, and safe inline styles. A
 *   `style` value may only set a numeric size or the error red, so `url(`,
 *   `expression(`, and similar shapes cannot survive.
 *
 * The output uses `output: 'html'` only, so the tag set is `span`. The KaTeX
 * stylesheet colors follow `currentColor` with Tokyo Night variables set by
 * the caller, for example `--notes-text` on the surrounding note.
 */
import katex from 'katex';

/**
 * The fixed resource limits of math rendering.
 *
 * A math source is short by nature. Two thousand characters already hold a
 * long display equation. One hundred macros stop an expansion loop before
 * KaTeX itself must. `maxSize` caps a user set size such as
 * `\rule{500em}{500em}` at fifty ems. `maxExpand` caps macro expansion at two
 * hundred steps, below the KaTeX default of one thousand.
 */
export const mathLimits = {
  /** Largest accepted math source, in characters. */
  maxSourceChars: 2000,
  /** Largest accepted number of control sequences in one source. */
  maxMacros: 100,
  /** Largest accepted KaTeX user set size, in ems. */
  maxSize: 50,
  /** Largest accepted KaTeX macro expansion count. */
  maxExpand: 100,
} as const;

/** Why math rendering was refused. */
export type MathRenderReason = 'limit' | 'syntax';

/**
 * A math source that was refused.
 *
 * `limit` means the source exceeds `mathLimits`. `syntax` means KaTeX threw a
 * parse error. Both cases keep editable source: the caller shows the source
 * region instead of rendered math.
 */
export class MathRenderError extends Error {
  readonly reason: MathRenderReason;

  constructor(reason: MathRenderReason, detail: string) {
    super(`notesapp math ${reason}: ${detail}`);
    this.name = 'MathRenderError';
    this.reason = reason;
  }
}

/** Counts the control sequences of one source, for example `\frac`. */
function countMacros(source: string): number {
  const matches = source.match(/\\[a-zA-Z]+/g);
  return matches === null ? 0 : matches.length;
}

/** The inline style properties KaTeX HTML needs for layout. */
const allowedStyleProperties = new Set([
  'height',
  'top',
  'margin-right',
  'margin-left',
  'margin-top',
  'margin-bottom',
  'padding-left',
  'border-bottom-width',
  'border-right-width',
  'width',
  'min-width',
  'max-width',
  'vertical-align',
  'position',
  'left',
  'right',
  'color',
]);

/** A numeric KaTeX size such as `0.68em` or `-3.06em`. */
const sizeValue = /^-?[0-9]*\.?[0-9]+(?:em|ex|px|pt|%)$/;

/** The KaTeX error red, the only accepted color value. */
const errorColorValue = /^#(?:cc0000|[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Reports whether one `property: value` pair may stay in a style. */
function isSafeStyleDeclaration(property: string, value: string): boolean {
  const name = property.trim().toLowerCase();
  const text = value.trim().toLowerCase();
  if (!allowedStyleProperties.has(name)) return false;
  if (name === 'color') return errorColorValue.test(text);
  if (name === 'position') return text === 'relative';
  return sizeValue.test(text);
}

/**
 * Keeps only safe declarations of one style attribute value.
 *
 * Returns the cleaned value, or `null` when nothing may stay. A dropped
 * declaration only changes layout, never content: the text remains.
 */
function sanitizeStyleValue(raw: string): string | null {
  const kept: string[] = [];
  for (const part of raw.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const property = part.slice(0, colon);
    const value = part.slice(colon + 1);
    if (isSafeStyleDeclaration(property, value))
      kept.push(
        `${property.trim().toLowerCase()}:${value.trim().toLowerCase()}`,
      );
  }
  return kept.length === 0 ? null : kept.join(';');
}

/** A class token the KaTeX HTML emitter writes. */
const classToken = /^[a-zA-Z0-9_-]+$/;

/**
 * Reports whether a class attribute value may stay.
 *
 * A class cannot execute, so the check is a shape check only: non empty
 * tokens of letters, digits, underscore, and hyphen. An empty class is
 * dropped rather than kept as an empty attribute.
 */
function isSafeClassValue(raw: string): boolean {
  const tokens = raw.split(/[\s]+/).filter((token) => token !== '');
  return tokens.length > 0 && tokens.every((token) => classToken.test(token));
}

/** Parses the attributes of one tag into name and raw value pairs. */
function parseAttributes(raw: string): Array<{ name: string; value: string }> {
  const found: Array<{ name: string; value: string }> = [];
  const pattern =
    /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  for (;;) {
    const match = pattern.exec(raw);
    if (match === null) return found;
    const name = (match[1] ?? '').toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (name !== '') found.push({ name, value });
  }
}

/**
 * Sanitizes KaTeX HTML output.
 *
 * Only `span` elements survive, with `class`, `aria-hidden`, and safe
 * `style` attributes. Every other element is dropped but its text content is
 * kept, so no content is lost. Every other attribute is dropped. The result
 * holds no `script`, no event handler, no `href`, no `src`, and no `url(`.
 */
export function sanitizeMathHtml(html: string): string {
  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*)?(\/?)>/g;
  let result = '';
  let index = 0;
  for (;;) {
    const match = tagPattern.exec(html);
    if (match === null) {
      result += html.slice(index);
      return result;
    }
    const full = match[0] ?? '';
    const tagName = (match[1] ?? '').toLowerCase();
    const rawAttributes = match[2] ?? '';
    const start = match.index ?? 0;
    result += html.slice(index, start);
    index = start + full.length;
    const closing = full.startsWith('</');
    if (tagName !== 'span') continue;
    if (closing) {
      result += '</span>';
      continue;
    }
    const kept: string[] = [];
    for (const attribute of parseAttributes(rawAttributes)) {
      if (attribute.name === 'class') {
        if (isSafeClassValue(attribute.value))
          kept.push(`class="${attribute.value}"`);
      } else if (attribute.name === 'aria-hidden') {
        if (attribute.value === 'true' || attribute.value === 'false')
          kept.push(`aria-hidden="${attribute.value}"`);
      } else if (attribute.name === 'style') {
        const cleaned = sanitizeStyleValue(attribute.value);
        if (cleaned !== null) kept.push(`style="${cleaned}"`);
      }
    }
    result += kept.length === 0 ? '<span>' : `<span ${kept.join(' ')}>`;
  }
}

/**
 * Renders one math source into sanitized KaTeX markup.
 *
 * Throws `MathRenderError` with reason `limit` when the source exceeds
 * `mathLimits`, and with reason `syntax` when KaTeX refuses it. The caller
 * keeps the editable source in both cases. The returned string holds only
 * sanitized `span` elements and is safe to insert as HTML.
 */
export function renderMath(source: string, display: boolean): string {
  if (source.length > mathLimits.maxSourceChars)
    throw new MathRenderError(
      'limit',
      `math source is ${String(source.length)} characters and the limit is ${String(mathLimits.maxSourceChars)}`,
    );
  if (countMacros(source) > mathLimits.maxMacros)
    throw new MathRenderError(
      'limit',
      `math source holds more than ${String(mathLimits.maxMacros)} macros`,
    );
  let html: string;
  try {
    html = katex.renderToString(source, {
      displayMode: display,
      trust: false,
      strict: 'error',
      throwOnError: true,
      output: 'html',
      maxSize: mathLimits.maxSize,
      maxExpand: mathLimits.maxExpand,
    });
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? error.message : 'KaTeX refused the source';
    throw new MathRenderError('syntax', detail);
  }
  return sanitizeMathHtml(html);
}
