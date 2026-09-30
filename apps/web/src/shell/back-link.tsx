/**
 * The one back control of a page (record 0138).
 *
 * It stands before the title in `PageHeader`: a ghost caret with a name and a
 * title, pulled onto the edge of the column so its mark lines up with the
 * text below. The route table names the page, and `backTarget` in
 * `lib/breadcrumb.ts` names the page above it, so no page chooses where its
 * back control goes or what it is called. A page with nothing above it draws
 * nothing.
 */
import type { ReactNode } from 'react';
import { Link, useMatches, useParams } from 'react-router';
import {
  buttonClassName,
  ChevronLeftIcon,
  compactButtonVisualClassName,
  edgeControlClassName,
} from '@notesapp/ui';
import { backTarget, framePageOf } from '../lib/breadcrumb.ts';

/** The caret back to the page above the open page. */
export function BackLink(): ReactNode {
  const matches = useMatches();
  const params = useParams();
  const workspaceId =
    typeof params.workspaceId === 'string' ? params.workspaceId : '';
  const fileId = typeof params.fileId === 'string' ? params.fileId : null;
  const target = backTarget(
    framePageOf(matches.map((match) => match.handle)),
    workspaceId,
    fileId,
  );
  if (target === null) return null;
  return (
    <Link
      className={buttonClassName({
        variant: 'ghost',
        size: 'sm',
        iconOnly: true,
        compact: true,
        className: `shrink-0 ${edgeControlClassName({ edge: 'start', mark: 'icon' })}`,
      })}
      to={target.to}
      aria-label={target.label}
      title={target.label}
    >
      <span
        className={compactButtonVisualClassName({
          variant: 'ghost',
          size: 'sm',
          iconOnly: true,
        })}
        aria-hidden="true"
      >
        <ChevronLeftIcon />
      </span>
    </Link>
  );
}
