/** Online and offline workspace search with stable link insertion. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  searchFiles as searchRemote,
  type SearchHit,
} from '@notesapp/api-client';
import { searchLocal, type LocalStore } from '@notesapp/sync';
import { Button, StatusRegion } from '@notesapp/ui';
import { problemMessage } from '../app.tsx';

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
  return (
    <section aria-labelledby="workspace-search-heading">
      <h2 id="workspace-search-heading">Search</h2>
      <label className="notes-label" htmlFor="workspace-search-query">
        Search notes
      </label>
      <input
        id="workspace-search-query"
        className="notes-input"
        type="search"
        value={query}
        onChange={(event): void => setQuery(event.target.value)}
      />
      {message === '' ? null : <StatusRegion message={message} />}
      {query.trim() === '' ? null : hits.length === 0 ? (
        <p>No matching notes.</p>
      ) : (
        <ul className="notes-search-results">
          {hits.map((hit) => (
            <li key={hit.fileId}>
              <Link
                className="notes-tree-link"
                to={`/w/${workspaceId}/notes/${hit.fileId}`}
                onClick={onNavigate}
              >
                {hit.path}
              </Link>
              <p>{hit.excerpt}</p>
              <Button
                variant="secondary"
                label={`Insert a stable link to ${hit.path}`}
                onClick={() => requestLink(hit)}
              >
                Insert link
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
