/** Image policy for future publication and fixed release readback. */
import { githubRepository } from './pr-screenshots.mjs';

/** @param {string} origin */
export function releaseImage(origin) {
  return `ghcr.io/${githubRepository(origin).toLowerCase()}`;
}

/** @param {unknown} reference */
export function registryImage(reference) {
  if (typeof reference !== 'string')
    throw new Error('The release image address is invalid.');
  const match =
    /^ghcr\.io\/([a-z0-9][a-z0-9_-]*)\/([a-z0-9][a-z0-9._-]*)$/.exec(reference);
  const owner = match?.[1],
    name = match?.[2];
  if (!owner || !name) throw new Error('The release image address is invalid.');
  return { reference, owner, name };
}

/** @param {string} origin @param {unknown} reference @param {boolean} published */
export function publicationImage(origin, reference, published) {
  const image = registryImage(reference);
  const legacy = image.reference !== releaseImage(origin);
  if (legacy && !published)
    throw new Error(
      'The draft uses an old image package. Prepare a new release before publication.',
    );
  return { ...image, legacy };
}

/** A fixed manifest is authoritative. A historical workflow is the fallback.
 * @param {string} origin @param {string} workflow @param {unknown} [manifestReference]
 */
export function diagnosticImage(origin, workflow, manifestReference) {
  if (manifestReference !== undefined) return registryImage(manifestReference);
  const historical = /^\s*IMAGE:\s*(\S+)\s*$/m.exec(workflow)?.[1];
  return registryImage(historical ?? releaseImage(origin));
}
