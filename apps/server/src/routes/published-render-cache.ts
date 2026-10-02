/**
 * The rendered bodies of published notes, kept by what decides them.
 *
 * A published link is public, and the page renders its note with the HTML
 * parse and the highlighter of `@notesapp/markdown` for up to the size limit
 * of a note. Without a cache every request of a reader rendered again, so a
 * link could drive the processor of the server by its requests alone.
 *
 * The body of a note depends on the head revision of the note, on the notes
 * and the pictures that the link opens, and on the addresses of the page,
 * which carry the token and the ticket. `publishedRenderKey` digests exactly
 * those, so a new revision, a note added to a folder or a new ticket renders
 * again, and nothing else does. The cache holds a bounded count of bodies and
 * a bounded count of characters, and it drops the oldest first.
 */
import { createHash } from 'node:crypto';

/** The bounds of one cache. */
export type RenderCacheBounds = {
  /** The most bodies that the cache keeps. */
  readonly entries: number;
  /** The most characters that the kept bodies hold together. */
  readonly characters: number;
};

/** The bounds of the cache of the reader path. */
export const publishedRenderCacheBounds: RenderCacheBounds = {
  entries: 128,
  characters: 32 * 1024 * 1024,
};

/** One cache of rendered bodies. */
export type RenderCache = {
  /** The body of one key, rendered by `render` when the cache holds none. */
  readonly body: (
    key: string,
    render: () => Promise<string>,
  ) => Promise<string>;
  /** How many bodies the cache holds now. */
  readonly size: () => number;
};

/** Builds one bounded cache that drops its oldest body first. */
export function createRenderCache(bounds: RenderCacheBounds): RenderCache {
  const kept = new Map<string, string>();
  let characters = 0;
  return {
    body: async (key, render) => {
      const found = kept.get(key);
      if (found !== undefined) {
        // A body that is read again becomes the newest one.
        kept.delete(key);
        kept.set(key, found);
        return found;
      }
      const body = await render();
      // A body larger than the whole budget is answered and never kept.
      if (body.length > bounds.characters) return body;
      kept.set(key, body);
      characters += body.length;
      for (const [oldest, value] of kept) {
        if (kept.size <= bounds.entries && characters <= bounds.characters)
          break;
        kept.delete(oldest);
        characters -= value.length;
      }
      return body;
    },
    size: () => kept.size,
  };
}

/** What decides the body of one published note. */
export type PublishedRenderInput = {
  readonly fileId: string;
  readonly revisionId: string;
  readonly path: string;
  readonly token: string;
  readonly ticket: string | null;
  /** Every note that the link opens, by identifier and path. */
  readonly notes: readonly (readonly [string, string])[];
  /** Every picture reference of the note and the revision it names now. */
  readonly attachments: readonly (readonly [string, string])[];
};

/**
 * The key of one body: a digest of everything that decides it.
 *
 * The token and the ticket are secrets of the address, so the key holds
 * their digest only.
 */
export function publishedRenderKey(input: PublishedRenderInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.fileId,
        input.revisionId,
        input.path,
        input.token,
        input.ticket,
        input.notes,
        input.attachments,
      ]),
    )
    .digest('base64url');
}
