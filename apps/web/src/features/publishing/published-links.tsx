/**
 * Published links: every read-only link of one workspace, with Revoke.
 *
 * The list is the audit surface of the feature. A person who has shared a note
 * needs one place that answers the question "what is open right now", and the
 * answer has to include "nothing", so the screen and its entry in the sidebar
 * stay there while the workspace holds no link.
 *
 * No entry of this screen holds a token. The create answer is the one answer
 * of the whole interface that carries one, so a row here names what the link
 * opens and never how to open it. The screen reports no reader count, because
 * the reader path counts nothing, as decision 0031 states.
 *
 * Revoke acts at once and asks nothing. A person revokes a link because it
 * reached somebody it should not have reached, and a confirmation step would
 * slow down the one action that a person wants to be immediate. The step back
 * is to publish again, which costs one dialog.
 *
 * Every rule of the rows lives in `publishing.ts` with its unit test. Every
 * server call is a generated operation.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Link, useParams } from 'react-router';
import {
  listPublishedLinks,
  revokePublishedLink,
  type PublishedLink,
} from '@notesapp/api-client';
import {
  Button,
  buttonClassName,
  Card,
  EmptyState,
  LinkIcon,
  ListRow,
  LoadingState,
  Notice,
  Page,
  PageHeader,
} from '@notesapp/ui';
import { problemMessage } from '../../app.tsx';
import { useDocumentTitle } from '../../shell/document-title.ts';
import { useFiles } from '../../shell/files.tsx';
import {
  linkDetail,
  linkTitle,
  notesInScope,
  publishedLinksTitle,
  sortLinks,
} from './publishing.ts';

/** What the screen says under its title. */
const publishedLinksDescription =
  'A published link opens a note or a folder for a person who has no account. The person reads the note and cannot change it.';

/** How far the read of the list got. */
type ListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly links: readonly PublishedLink[] };

/** The published links of one workspace. */
export function PublishedLinksView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : null;
  useDocumentTitle(publishedLinksTitle);

  if (workspaceId === null)
    return (
      <Page>
        <PageHeader title={publishedLinksTitle} />
        <EmptyState
          icon={<LinkIcon size={24} />}
          title="This address names no workspace"
          description="Open your notes and select Published links in the sidebar."
        />
      </Page>
    );

  return <PublishedLinksList workspaceId={workspaceId} />;
}

/** The listing and the one action of the screen. */
function PublishedLinksList({
  workspaceId,
}: {
  readonly workspaceId: string;
}): ReactNode {
  const files = useFiles();
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');

  const reload = useCallback((): void => {
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    void listPublishedLinks({ path: { workspaceId } }).then((result) => {
      if (cancelled) return;
      if (result.error !== undefined || result.data === undefined) {
        setState({ kind: 'failed', message: problemMessage(result.error) });
        return;
      }
      setState({ kind: 'ready', links: result.data.links });
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, generation]);

  const now = Date.now();
  const notes = files.notes;
  const rows = useMemo(
    () =>
      state.kind === 'ready'
        ? sortLinks(state.links, (link) => linkTitle(link.scope, notes))
        : [],
    [state, notes],
  );

  const revoke = (link: PublishedLink, name: string): void => {
    if (busy !== null) return;
    setBusy(link.publicationId);
    setNotice('');
    setFailure('');
    void (async (): Promise<void> => {
      const result = await revokePublishedLink({
        path: { workspaceId, publicationId: link.publicationId },
      });
      setBusy(null);
      if (result.error !== undefined || result.data === undefined) {
        setFailure(problemMessage(result.error));
        return;
      }
      setState((current) =>
        current.kind === 'ready'
          ? {
              kind: 'ready',
              links: current.links.filter(
                (entry) => entry.publicationId !== link.publicationId,
              ),
            }
          : current,
      );
      setNotice(`The link to ${name} is revoked. It opens nothing now.`);
    })();
  };

  return (
    <Page>
      <PageHeader
        title={publishedLinksTitle}
        description={publishedLinksDescription}
        actions={
          <Link
            className={buttonClassName({ variant: 'secondary', size: 'sm' })}
            to={`/w/${workspaceId}`}
          >
            Back to your notes
          </Link>
        }
      />
      <div className="space-y-4">
        {notice === '' ? null : <Notice tone="success" message={notice} />}
        {failure === '' ? null : <Notice tone="problem" message={failure} />}
        {state.kind === 'loading' ? (
          <LoadingState
            shape="list"
            rows={3}
            label="Your published links are loading."
          />
        ) : state.kind === 'failed' ? (
          <Notice tone="problem" message={state.message}>
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          </Notice>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<LinkIcon size={24} />}
            title="No published links"
            description="Open a note or a folder and select Publish. You get one link that opens it for a person who has no account."
          />
        ) : (
          <Card title="Your links" titleId="published-links-heading">
            <ul className="m-0 list-none p-0">
              {rows.map((link) => {
                const name = linkTitle(link.scope, notes);
                return (
                  <ListRow key={link.publicationId} className="flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-ui font-medium text-strong">
                        {name}
                      </p>
                      <p className="m-0 truncate text-control text-muted">
                        {linkDetail(link, notesInScope(link.scope, notes), now)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-cluster">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy !== null}
                        title={`Revoke the link to ${name}`}
                        onClick={() => revoke(link, name)}
                      >
                        Revoke
                      </Button>
                    </div>
                  </ListRow>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </Page>
  );
}
