/**
 * The fragment of a heading.
 *
 * `renderMarkdown` gives each heading an identifier from this slug, and a link
 * that names a heading, such as the fragment of a converted wiki link
 * (record 0171), writes the same slug. It lives apart from the renderer, so a
 * module that needs the slug loads no part of the HTML pipeline.
 */

/** One safe fragment identifier derived from heading text. */
export function headingSlug(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
