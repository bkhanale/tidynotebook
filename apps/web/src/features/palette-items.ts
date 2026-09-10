/**
 * Ranking of the command palette.
 *
 * One list answers one query. A note whose name matches comes first,
 * because a person who types a name wants that note. A note that only
 * matches in its text follows, with the part of the note that matched. A note
 * is never listed twice, whatever the source of the match was. Actions match
 * on their own words and sit under the notes.
 *
 * The content matches arrive already ranked, the server first and this device
 * after it, so this module keeps the order it was given.
 */
import type { ExcerptPart } from '@notesapp/core';

/** One note the palette can open. */
export type PaletteNote = {
  readonly fileId: string;
  readonly path: string;
  readonly updatedAt: string;
};

/** One content match from the local index or from the server. */
export type PaletteHit = {
  readonly fileId: string;
  readonly path: string;
  readonly excerpt: readonly ExcerptPart[];
};

/** One ranked row of the note part of the list. */
export type NoteMatch = {
  readonly fileId: string;
  readonly path: string;
  /** The matching part of the note, when the match was in its text. */
  readonly excerpt: readonly ExcerptPart[] | null;
};

/** Joins server and local content hits, keeping one row per note. */
export function mergeHits(
  remote: readonly PaletteHit[],
  local: readonly PaletteHit[],
): readonly PaletteHit[] {
  const byFile = new Map(remote.map((hit) => [hit.fileId, hit]));
  for (const hit of local) byFile.set(hit.fileId, hit);
  return [...byFile.values()];
}

/**
 * Ranks the notes for one query.
 *
 * An empty query answers the most recently changed notes, which is what a
 * person wants when they open the palette to move somewhere.
 */
export function rankNotes(
  query: string,
  notes: readonly PaletteNote[],
  hits: readonly PaletteHit[],
  limit: number,
): readonly NoteMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === '')
    return [...notes]
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )
      .slice(0, limit)
      .map((note) => ({ fileId: note.fileId, path: note.path, excerpt: null }));

  const byName = notes
    .map((note) => ({
      note,
      at: note.path.toLowerCase().indexOf(needle),
    }))
    .filter((entry) => entry.at >= 0)
    .sort((left, right) =>
      left.at !== right.at
        ? left.at - right.at
        : left.note.path < right.note.path
          ? -1
          : 1,
    )
    .map((entry): NoteMatch => ({
      fileId: entry.note.fileId,
      path: entry.note.path,
      excerpt: null,
    }));

  const named = new Set(byName.map((match) => match.fileId));
  const byContent = hits
    .filter((hit) => !named.has(hit.fileId))
    .map((hit): NoteMatch => ({
      fileId: hit.fileId,
      path: hit.path,
      excerpt: hit.excerpt,
    }));

  return [...byName, ...byContent].slice(0, limit);
}

/** One action the palette can run. */
export type PaletteAction = {
  readonly id: string;
  readonly label: string;
  /** Extra words that also find this action, such as "palette" or "dark". */
  readonly keywords?: string | undefined;
  readonly run: () => void;
};

/** The actions whose words contain the query. */
export function rankActions(
  query: string,
  actions: readonly PaletteAction[],
): readonly PaletteAction[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return actions;
  return actions.filter((action) =>
    `${action.label} ${action.keywords ?? ''}`.toLowerCase().includes(needle),
  );
}
