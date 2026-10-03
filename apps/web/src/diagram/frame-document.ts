/**
 * The built diagram frame document, as pure text.
 *
 * The frame runs sandboxed with an opaque origin, so it loads no file of the
 * application: a font or a stylesheet of the origin is a cross origin request
 * that the frame cannot make (QA-04). The build therefore writes the whole
 * frame into one document. `diagramFrame` in `apps/web/vite.config.ts` reads
 * the files and calls the functions here, which decide the text.
 *
 * The stylesheet of the frame is `apps/web/src/tailwind.css`, compiled by the
 * same Tailwind plugin as the application, so the frame has no style and no
 * face of its own (record 0061). Each face that the stylesheet declares
 * travels inside it as a `data:` address, which the content policy of the
 * frame permits in `font-src`.
 */

/** A face file that the stylesheet names, by its served address. */
const fontAddress = /url\((['"]?)(\/fonts\/[A-Za-z0-9._-]+\.woff2)\1\)/g;

/**
 * Every face file that a built stylesheet names, once each, in order.
 *
 * @param css the built stylesheet.
 */
export function fontAddresses(css: string): readonly string[] {
  return [...new Set([...css.matchAll(fontAddress)].map((m) => m[2] ?? ''))];
}

/**
 * The stylesheet with each face file written inside it.
 *
 * A face that the stylesheet names and the build did not read is an error,
 * so a frame never ships with a face that it cannot load.
 *
 * @param css the built stylesheet.
 * @param fonts the base64 text of each face file, by its served address.
 */
export function inlineFontFaces(
  css: string,
  fonts: ReadonlyMap<string, string>,
): string {
  return css.replace(fontAddress, (_match, _quote, address: string) => {
    const bytes = fonts.get(address);
    if (bytes === undefined)
      throw new Error(`The diagram frame has no bytes for ${address}.`);
    return `url(data:font/woff2;base64,${bytes})`;
  });
}

/** The entry of the frame template that the build replaces. */
export const frameEntry =
  '<script type="module" src="./frame-main.ts"></script>';

/**
 * The frame document with its stylesheet and its script written inside it.
 *
 * The replacement is a function on purpose: minified code holds `$&` and
 * `` $` `` sequences that a string replacement would expand. A literal
 * closing tag inside the script would end the element, so it is escaped.
 *
 * @param template the source of `src/diagram/frame.html`.
 * @param styles the built stylesheet, with its faces inside it.
 * @param script the built frame script.
 */
export function frameDocumentSource(
  template: string,
  styles: string,
  script: string,
): string {
  if (!template.includes(frameEntry))
    throw new Error('The diagram frame template names no entry script.');
  if (script === '') throw new Error('The diagram frame produced no script.');
  if (styles === '')
    throw new Error('The diagram frame produced no stylesheet.');
  const inlineScript = script.replaceAll('</script', '<\\/script');
  const inlineStyles = styles.replaceAll('</style', '<\\/style');
  return template.replace(
    frameEntry,
    () => `<style>${inlineStyles}</style><script>${inlineScript}</script>`,
  );
}
