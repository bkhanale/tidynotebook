/**
 * The page of an address that names no page of the frame.
 *
 * It is a page of the workspace frame and not a bare sentence (record 0091):
 * the sidebar and the breadcrumb stay, and the page holds the one title, one
 * sentence and the one way out to the notes of the workspace.
 */
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  buttonClassName,
  ChevronLeftIcon,
  Page,
  PageHeader,
} from '@notesapp/ui';
import { useDocumentTitle } from './document-title.ts';

/** The title of the page, which is also the last part of the breadcrumb. */
export const notFoundTitle = 'Page not found';

/** Shown for an address under a workspace that names no route. */
export function NotFoundView(): ReactNode {
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : '';
  useDocumentTitle(notFoundTitle);
  return (
    <Page>
      <PageHeader title={notFoundTitle} />
      <p className="mb-6 mt-0 text-control text-muted">
        The address names no page of this application.
      </p>
      <Link
        className={buttonClassName({ variant: 'secondary' })}
        to={`/w/${workspaceId}`}
      >
        <span className="inline-flex items-center" aria-hidden="true">
          <ChevronLeftIcon />
        </span>
        <span>Back to your notes</span>
      </Link>
    </Page>
  );
}
