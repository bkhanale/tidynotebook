/**
 * The one command palette of the application.
 *
 * `Cmd or Ctrl + K` opens it, and `Cmd or Ctrl + O` stays as an alias for
 * the people who learned it. There is no second search surface: the header
 * affordance opens this same dialog at every width, so a phone can search.
 *
 * An empty query lists the notes that changed last. A query lists the notes
 * whose name matches, then the notes whose text matches, then the actions.
 * The list is one `listbox`; the input keeps focus and points at the
 * highlighted row with `aria-activedescendant`.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { searchFiles as searchRemote } from '@notesapp/api-client';
import { searchLocal, type LocalStore } from '@notesapp/sync';
import { Dialog, SearchIcon } from '@notesapp/ui';
import { displayNoteName } from './note-name.ts';
import {
  mergeHits,
  rankActions,
  rankNotes,
  type NoteMatch,
  type PaletteAction,
  type PaletteHit,
  type PaletteNote,
} from './palette-items.ts';

/** How many notes the list can hold at once. */
const noteLimit = 12;

/** How long the palette waits after a keystroke before it searches. */
const searchDelayMs = 150;

/** One row of the rendered list. */
type Row =
  | { readonly kind: 'note'; readonly id: string; readonly match: NoteMatch }
  | {
      readonly kind: 'action';
      readonly id: string;
      readonly action: PaletteAction;
    };

/** Reads the content matches of one query from this device and the server. */
function useContentHits(
  query: string,
  store: LocalStore | null,
  accountId: string | null,
  workspaceId: string,
): { readonly hits: readonly PaletteHit[]; readonly offline: boolean } {
  const [hits, setHits] = useState<readonly PaletteHit[]>([]);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const needle = query.trim();
    if (needle === '') {
      setHits([]);
      setOffline(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async (): Promise<void> => {
        const localPromise =
          store === null || accountId === null
            ? Promise.resolve([])
            : store
                .listSearchFiles(accountId, workspaceId)
                .then((files) => searchLocal(needle, files));
        const remotePromise = navigator.onLine
          ? searchRemote({
              path: { workspaceId },
              query: { query: needle, limit: 50 },
            })
          : Promise.resolve(null);
        try {
          const [localHits, remoteResult] = await Promise.all([
            localPromise,
            remotePromise,
          ]);
          if (cancelled) return;
          const remoteHits =
            remoteResult === null ||
            remoteResult.error !== undefined ||
            remoteResult.data === undefined
              ? []
              : remoteResult.data.hits;
          setOffline(remoteResult === null);
          setHits(mergeHits(remoteHits, localHits));
        } catch {
          if (!cancelled) setHits([]);
        }
      })();
    }, searchDelayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, store, accountId, workspaceId]);

  return { hits, offline };
}

/** The command palette dialog. */
export function CommandPalette({
  open,
  onOpenChange,
  workspaceId,
  notes,
  store,
  accountId,
  actions,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workspaceId: string;
  readonly notes: readonly PaletteNote[];
  readonly store: LocalStore | null;
  readonly accountId: string | null;
  readonly actions: readonly PaletteAction[];
}): ReactNode {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const content = useContentHits(query, store, accountId, workspaceId);

  const rows = useMemo<readonly Row[]>(() => {
    const noteRows = rankNotes(query, notes, content.hits, noteLimit).map(
      (match): Row => ({
        kind: 'note',
        id: `palette-note-${match.fileId}`,
        match,
      }),
    );
    const actionRows = rankActions(query, actions).map((action): Row => ({
      kind: 'action',
      id: `palette-action-${action.id}`,
      action,
    }));
    return [...noteRows, ...actionRows];
  }, [query, notes, content.hits, actions]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, selected, rows]);

  if (!open) return null;

  const run = (row: Row | undefined): void => {
    if (row === undefined) return;
    onOpenChange(false);
    if (row.kind === 'note') {
      void navigate(`/w/${workspaceId}/notes/${row.match.fileId}`);
      return;
    }
    row.action.run();
  };

  const activeId = rows[selected]?.id;

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Search notes and run actions"
      titleId="command-palette-title"
      hideTitle
      width="medium"
    >
      <div className="flex items-center gap-3 border-b border-edge-subtle px-4">
        <span className="text-muted" aria-hidden="true">
          <SearchIcon size={18} />
        </span>
        <input
          ref={inputRef}
          type="text"
          className="min-w-0 flex-1 border-0 bg-transparent py-4 text-base text-strong outline-none placeholder:text-muted"
          value={query}
          placeholder="Search notes, or type an action"
          aria-label="Search notes, or type an action"
          aria-controls="command-palette-list"
          aria-activedescendant={activeId}
          autoComplete="off"
          onChange={(event): void => setQuery(event.target.value)}
          onKeyDown={(event): void => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelected((value) =>
                rows.length === 0 ? 0 : (value + 1) % rows.length,
              );
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected((value) =>
                rows.length === 0 ? 0 : (value - 1 + rows.length) % rows.length,
              );
            } else if (event.key === 'Home') {
              event.preventDefault();
              setSelected(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              setSelected(Math.max(rows.length - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              run(rows[selected]);
            }
          }}
        />
        <kbd className="hidden rounded border border-edge bg-hover px-1.5 py-0.5 text-control text-muted sm:inline">
          Esc
        </kbd>
      </div>
      {content.offline ? (
        <p className="m-0 border-b border-edge-subtle px-4 py-2 text-control text-muted">
          No connection. These results come from this device.
        </p>
      ) : null}
      <ul
        ref={listRef}
        id="command-palette-list"
        className="m-0 max-h-80 list-none overflow-y-auto p-2"
        role="listbox"
        aria-label="Results"
      >
        {rows.map((row, index) => (
          <li
            key={row.id}
            id={row.id}
            role="option"
            aria-selected={index === selected}
            className={`flex min-h-11 cursor-pointer flex-col justify-center rounded-lg px-3 py-2 ${index === selected ? 'bg-active text-strong' : 'text-ink hover:bg-hover'}`}
            onMouseEnter={() => setSelected(index)}
            onMouseDown={(event): void => {
              event.preventDefault();
              run(row);
            }}
          >
            {row.kind === 'note' ? (
              <>
                <span className="truncate text-ui font-medium">
                  {displayNoteName(row.match.path)}
                </span>
                {row.match.excerpt === null ? null : (
                  <span className="truncate text-control text-muted">
                    {row.match.excerpt}
                  </span>
                )}
              </>
            ) : (
              <span className="truncate text-ui">{row.action.label}</span>
            )}
          </li>
        ))}
      </ul>
      {rows.length === 0 ? (
        <p className="m-4 text-control text-muted">
          No note and no action matches that.
        </p>
      ) : null}
    </Dialog>
  );
}
