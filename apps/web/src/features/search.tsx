/** Online and offline workspace search with stable link insertion. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  searchFiles as searchRemote,
  type SearchHit,
  type WorkspaceFileSummary,
} from '@notesapp/api-client';
import { searchLocal, type LocalStore } from '@notesapp/sync';
import { Button, SearchIcon, StatusRegion } from '@notesapp/ui';
import { problemMessage } from '../app.tsx';
import { displayNoteName } from './note-name.ts';

/** Data carried by the editor link insertion event. */
export type StableLinkRequest = {
  readonly fileId: string;
  readonly label: string;
};

/** Markdown for one selected stable note target. */
export function stableNoteLink(request: StableLinkRequest): string {
  const label = request.label.replaceAll(']', '\\]');
  return `[${label}](/notes/${request.fileId})`;
}

/** Requests insertion into the active editor selection. */
function requestLink(hit: SearchHit): void {
  window.dispatchEvent(
    new CustomEvent<StableLinkRequest>('notesapp:insert-link', {
      detail: { fileId: hit.fileId, label: hit.path.replace(/\.md$/i, '') },
    }),
  );
}

/** Combines remote accepted hits with local hits, preferring local state. */
function mergeHits(
  remote: readonly SearchHit[],
  local: readonly SearchHit[],
): readonly SearchHit[] {
  const result = new Map(remote.map((hit) => [hit.fileId, hit]));
  for (const hit of local) result.set(hit.fileId, hit);
  return [...result.values()].sort((left, right) =>
    left.path < right.path ? -1 : 1,
  );
}

/** Search controls for one account and workspace. */
export function SearchDialog({
  store,
  accountId,
  workspaceId,
  onNavigate,
}: {
  readonly store: LocalStore | null;
  readonly accountId: string | null;
  readonly workspaceId: string;
  readonly onNavigate: () => void;
}): ReactNode {
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState<readonly SearchHit[]>([]);
  const [local, setLocal] = useState<readonly SearchHit[]>([]);
  const [message, setMessage] = useState('');
  const searchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized === '') {
      setRemote([]);
      setLocal([]);
      setMessage('');
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      async function run(): Promise<void> {
        const localPromise =
          store === null || accountId === null
            ? Promise.resolve([])
            : store
                .listSearchFiles(accountId, workspaceId)
                .then((files) => searchLocal(normalized, files));
        const remotePromise = navigator.onLine
          ? searchRemote({
              path: { workspaceId },
              query: { query: normalized, limit: 50 },
            })
          : Promise.resolve(null);
        try {
          const [localHits, remoteResult] = await Promise.all([
            localPromise,
            remotePromise,
          ]);
          if (cancelled) return;
          setLocal(localHits);
          if (remoteResult === null) {
            setRemote([]);
            setMessage('Offline results from this device.');
          } else if (
            remoteResult.error !== undefined ||
            remoteResult.data === undefined
          ) {
            setRemote([]);
            setMessage(problemMessage(remoteResult.error));
          } else {
            setRemote(remoteResult.data.hits);
            setMessage('');
          }
        } catch (error: unknown) {
          if (!cancelled)
            setMessage(
              error instanceof Error ? error.message : 'Search failed.',
            );
        }
      }
      void run();
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accountId, query, store, workspaceId]);

  const hits = useMemo(() => mergeHits(remote, local), [remote, local]);
  const showResults = query.trim() !== '';

  useEffect(() => {
    if (!showResults) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setQuery('');
    };
    const closeOnPointer = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && !searchRef.current?.contains(target))
        setQuery('');
    };
    window.addEventListener('keydown', closeOnEscape);
    document.addEventListener('mousedown', closeOnPointer);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('mousedown', closeOnPointer);
    };
  }, [showResults]);

  return (
    <div
      ref={searchRef}
      className="relative hidden min-w-48 max-w-xl flex-1 items-center gap-2 rounded-lg border border-edge-subtle bg-app px-3 focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/25 sm:flex"
    >
      <span className="text-muted">
        <SearchIcon size={15} />
      </span>
      <label className="sr-only" htmlFor="workspace-search-query">
        Search note content
      </label>
      <input
        id="workspace-search-query"
        className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-control text-strong outline-none placeholder:text-muted"
        type="search"
        value={query}
        placeholder="Search note content"
        autoComplete="off"
        onChange={(event): void => setQuery(event.target.value)}
      />
      {showResults ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-lg border border-edge-subtle bg-card p-2 shadow-xl">
          {message === '' ? null : <StatusRegion message={message} />}
          {hits.length === 0 ? (
            <p className="m-2 text-control text-muted">No matching notes.</p>
          ) : (
            <ul className="m-0 list-none space-y-1 p-0">
              {hits.map((hit) => (
                <li
                  className="flex items-center gap-2 rounded-md p-1 hover:bg-hover"
                  key={hit.fileId}
                >
                  <Link
                    className="flex min-w-0 flex-1 flex-col rounded px-2 py-1 text-control text-strong no-underline focus-visible:outline-2 focus-visible:outline-focus"
                    to={`/w/${workspaceId}/notes/${hit.fileId}`}
                    onClick={() => {
                      setQuery('');
                      onNavigate();
                    }}
                  >
                    <strong className="truncate font-medium">
                      {displayNoteName(hit.path)}
                    </strong>
                    <span className="truncate text-xs text-muted">
                      {hit.excerpt}
                    </span>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    label={`Insert a stable link to ${displayNoteName(hit.path)}`}
                    onClick={() => requestLink(hit)}
                  >
                    Insert link
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Spotlight-style note navigation opened by Cmd+O or Ctrl+O. */
export function QuickOpenDialog({
  open,
  workspaceId,
  files,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly workspaceId: string | null;
  readonly files: readonly WorkspaceFileSummary[];
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return files
      .filter((file) =>
        needle === '' ? true : file.path.toLowerCase().includes(needle),
      )
      .slice(0, 12);
  }, [files, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!open || workspaceId === null) return null;

  const openFile = (file: WorkspaceFileSummary | undefined): void => {
    if (file === undefined) return;
    onOpenChange(false);
    void navigate(`/w/${workspaceId}/notes/${file.fileId}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-24"
      role="presentation"
      onMouseDown={(event): void => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <section
        className="w-full max-w-xl overflow-hidden rounded-xl border border-edge-subtle bg-card shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Open note"
      >
        <div className="flex items-center gap-3 border-b border-edge-subtle px-4">
          <span className="text-muted">
            <SearchIcon size={18} />
          </span>
          <input
            ref={inputRef}
            type="search"
            className="min-w-0 flex-1 border-0 bg-transparent py-4 text-base text-strong outline-none placeholder:text-muted"
            value={query}
            placeholder="Open a note"
            aria-label="Open a note"
            autoComplete="off"
            onChange={(event): void => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event): void => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onOpenChange(false);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelected((value) =>
                  Math.min(value + 1, Math.max(results.length - 1, 0)),
                );
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected((value) => Math.max(value - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                openFile(results[selected]);
              }
            }}
          />
          <kbd className="rounded border border-edge-subtle bg-hover px-1.5 py-0.5 text-xs text-muted">
            Esc
          </kbd>
        </div>
        <ul
          className="m-0 max-h-80 list-none overflow-y-auto p-2"
          role="listbox"
        >
          {results.map((file, index) => (
            <li key={file.fileId}>
              <button
                type="button"
                className={`flex w-full cursor-pointer flex-col rounded-lg border-0 px-3 py-2 text-left ${index === selected ? 'bg-active text-strong' : 'bg-transparent text-ink hover:bg-hover'}`}
                role="option"
                aria-selected={index === selected}
                onMouseEnter={() => setSelected(index)}
                onClick={() => openFile(file)}
              >
                <span className="text-ui font-medium">
                  {displayNoteName(file.path)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {results.length === 0 ? (
          <p className="m-4 text-control text-muted">No matching notes.</p>
        ) : null}
      </section>
    </div>
  );
}
