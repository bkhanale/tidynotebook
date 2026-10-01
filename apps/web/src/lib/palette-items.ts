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
 *
 * Every action names its glyph here, and the palette, the sidebar and the
 * menus draw that one glyph, so one action never shows two marks.
 *
 * An action either runs at once or opens a second step: a list of choices
 * in the same palette, with the same search field and the same keys, such as
 * the templates of Insert from template (record 0149).
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

/**
 * The name of the glyph that one action carries.
 *
 * An action shows the same glyph wherever it appears: in the sidebar, in a
 * menu and in the command palette (decision 0065). The name is the one fact
 * that decides it, so this list is the name of every action glyph of the
 * application and `shell/action-icons.tsx` draws each one. A name and not a
 * component, because this module is pure and holds no JSX.
 */
export const actionIconNames = [
  'align-center',
  'align-left',
  'align-right',
  'bold',
  'bullet-list',
  'collapse-all',
  'delete',
  'duplicate',
  'expand-all',
  'export',
  'heading-one',
  'heading-three',
  'heading-two',
  'history',
  'image',
  'inline-code',
  'insert-link',
  'italic',
  'keyboard',
  'move',
  'move-down',
  'move-left',
  'move-right',
  'move-up',
  'new-folder',
  'new-note',
  'new-workspace',
  'ordered-list',
  'publish',
  'published-links',
  'accounts',
  'quote',
  'rename',
  'settings',
  'sidebar',
  'sign-out',
  'sort',
  'strikethrough',
  'table',
  'table-add-column',
  'table-add-row',
  'table-remove-column',
  'table-remove-row',
  'table-remove',
  'task-list',
  'template',
  'theme-dark',
  'theme-light',
  'theme-system',
  'today',
  'trash',
  'workspace',
] as const;

/** One glyph of {@link actionIconNames}. */
export type ActionIconName = (typeof actionIconNames)[number];

/** One row of the list that the second step of an action shows. */
export type PaletteChoice = {
  readonly id: string;
  readonly label: string;
  /** A quiet fact at the end of the row, such as a folder, or `null`. */
  readonly detail: string | null;
};

/** What the second step of an action lists. */
export type PaletteChoices =
  | { readonly status: 'loading'; readonly label: string }
  /** The choices cannot be read, for the one reason this sentence states. */
  | { readonly status: 'unavailable'; readonly message: string }
  | { readonly status: 'ready'; readonly choices: readonly PaletteChoice[] };

/**
 * The second step of an action: the palette lists choices and runs the one
 * that a person chooses.
 */
export type PalettePick = {
  /** The words of the search field while the palette lists the choices. */
  readonly placeholder: string;
  readonly choices: PaletteChoices;
  /** The empty state when there is no choice at all (decision 0038). */
  readonly empty: {
    readonly title: string;
    readonly description: string;
    /** The one action that fills the list, or `null`. */
    readonly action: {
      readonly label: string;
      readonly run: () => void;
    } | null;
  };
  /** The sentence when the query matches no choice. */
  readonly noMatch: string;
  readonly choose: (id: string) => void;
};

/** What every action states, whether it runs at once or opens a step. */
type PaletteActionBase = {
  readonly id: string;
  readonly label: string;
  /** Extra words that also find this action, such as "palette" or "dark". */
  readonly keywords?: string | undefined;
  /** The glyph of this action, which every other surface shows as well. */
  readonly icon: ActionIconName;
  /** The key line of this action, when a key runs it as well. */
  readonly keys?: string | undefined;
};

/** One action the palette can run, at once or through a list of choices. */
export type PaletteAction = PaletteActionBase &
  (
    | { readonly run: () => void; readonly pick?: undefined }
    | { readonly run?: undefined; readonly pick: PalettePick }
  );

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

/**
 * The choices of a step that match the query.
 *
 * A choice whose name matches comes first, the earlier match before the
 * later one, and a choice whose detail alone matches follows, so a person
 * who types the name of a folder finds every choice in it. An empty query
 * keeps the order of the caller, and so does a tie.
 */
export function rankChoices(
  query: string,
  choices: readonly PaletteChoice[],
): readonly PaletteChoice[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return choices;
  const byLabel = choices
    .map((choice, order) => ({
      choice,
      order,
      at: choice.label.toLowerCase().indexOf(needle),
    }))
    .filter((entry) => entry.at >= 0)
    .sort((left, right) => left.at - right.at || left.order - right.order)
    .map((entry) => entry.choice);
  const named = new Set(byLabel);
  const byDetail = choices.filter(
    (choice) =>
      !named.has(choice) &&
      (choice.detail ?? '').toLowerCase().includes(needle),
  );
  return [...byLabel, ...byDetail];
}
