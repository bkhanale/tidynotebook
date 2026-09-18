/**
 * The actions of the note route, in the frame header.
 *
 * The header is the context of the route: where a person is, then what they
 * can do here (record 0064). The note route puts History, Publish and a menu
 * of the rest there, through the one `HeaderSlot` of the frame. The note
 * surface itself keeps no control, so the name, the text and the word count
 * stay one page.
 *
 * Every action here is one the command palette already offers, and it runs
 * the same function, so a person meets one behaviour by two roads. Each row
 * draws the one glyph of its action from `shell/action-icons.tsx`, so the
 * menu, the palette and the sidebar cannot show three marks for one thing
 * (record 0065).
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  buttonClassName,
  Button,
  HistoryIcon,
  LinkIcon,
  Menu,
  MoreIcon,
  type MenuItem,
} from '@notesapp/ui';
import { actionIcon } from '../../shell/action-icons.tsx';
import { HeaderActions } from '../../shell/header-slot.tsx';

/** What the open note can do, as the header offers it. */
export type NoteHeaderActionsProps = {
  readonly workspaceId: string;
  readonly fileId: string;
  /** Moves the caret into the note name, so the person can write a new one. */
  readonly onRename: () => void;
  readonly onMoveToFolder: (() => void) | undefined;
  readonly onDuplicate: () => void;
  readonly onAttachImage: () => void;
  readonly onExport: () => void;
  readonly onPublish: (() => void) | undefined;
  readonly onDelete: () => void;
};

/** The History, Publish and note menu of the open note. */
export function NoteHeaderActions({
  workspaceId,
  fileId,
  onRename,
  onMoveToFolder,
  onDuplicate,
  onAttachImage,
  onExport,
  onPublish,
  onDelete,
}: NoteHeaderActionsProps): ReactNode {
  const items: MenuItem[] = [
    {
      id: 'rename',
      label: 'Rename',
      icon: actionIcon('rename'),
      onSelect: onRename,
    },
    ...(onMoveToFolder === undefined
      ? []
      : [
          {
            id: 'move',
            label: 'Move to folder',
            icon: actionIcon('move'),
            onSelect: onMoveToFolder,
          },
        ]),
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: actionIcon('duplicate'),
      onSelect: onDuplicate,
    },
    {
      id: 'attach-image',
      label: 'Attach an image',
      icon: actionIcon('image'),
      onSelect: onAttachImage,
    },
    {
      id: 'export',
      label: 'Export as Markdown',
      icon: actionIcon('export'),
      onSelect: onExport,
    },
  ];

  return (
    <HeaderActions>
      {/*
        A control that navigates is an anchor and never a button, so the
        middle click, the context menu and the address all keep working. It
        reads the same recipe as every button of the product.
      */}
      <Link
        className={buttonClassName({
          variant: 'ghost',
          className: 'size-11 px-0 md:size-8',
        })}
        to={`/w/${workspaceId}/notes/${fileId}/history`}
        aria-label="History"
        title="History"
      >
        <span className="inline-flex items-center justify-center" aria-hidden>
          <HistoryIcon />
        </span>
      </Link>
      {onPublish === undefined ? null : (
        // The word leaves the button on a narrow screen, where the header
        // also carries the breadcrumb, the search and the account. The name
        // and the tooltip stay, so the action is never a glyph alone.
        <Button
          variant="secondary"
          size="sm"
          icon={<LinkIcon />}
          label="Publish"
          title="Publish"
          onClick={onPublish}
        >
          <span className="hidden md:inline">Publish</span>
        </Button>
      )}
      {/*
        The rest of the actions of the note. Move to Trash is the one row that
        destroys something, so it takes the danger tone of the row recipe and
        stands in the pinned region under the separator, away from the row a
        person reaches for by mistake.
      */}
      <Menu
        label="Note actions"
        icon={<MoreIcon />}
        items={items}
        pinned={[
          {
            id: 'delete',
            label: 'Move to Trash',
            icon: actionIcon('delete'),
            danger: true,
            onSelect: onDelete,
          },
        ]}
      />
    </HeaderActions>
  );
}
