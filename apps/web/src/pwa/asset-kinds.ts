/**
 * The file kinds of the static application assets.
 *
 * Two rules read this one list. The build step of `precache.ts` stores a file
 * of these kinds in the precache of the worker, and `routing.ts` lets the
 * worker keep a request for a file of these kinds. A second list drifted from
 * the first once, so both rules ask this module and cannot disagree.
 */

/** The file kinds that the worker stores and serves. */
export const assetKinds: ReadonlySet<string> = new Set([
  'css',
  'html',
  'ico',
  'js',
  'otf',
  'png',
  'svg',
  'ttf',
  'webmanifest',
  'woff',
  'woff2',
]);

/** The kind of one address path, from the text after its last dot. */
export function kindOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Whether one address path names a static application asset. */
export function isAssetPath(path: string): boolean {
  return assetKinds.has(kindOf(path));
}
