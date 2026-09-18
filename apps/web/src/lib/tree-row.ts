/**
 * How one row of the folder tree states what it is.
 *
 * The tree shows two different things at the same time, and a person has to
 * tell them apart at a glance:
 *
 * - The **open note**, which is the note the screen next to the tree shows.
 * - The **selected folder**, which is the parent that New note and New folder
 *   use.
 *
 * Both marks are fills now, and neither is an edge (decision 0064). The open
 * note takes the mark of `rowClassName`, the one recipe of a row: the active
 * surface, the strong text and the medium weight. The selected folder takes
 * the hover surface, which is the quieter of the two fills, so a note sitting
 * directly under its own folder still reads as two rows. Nothing in the tree
 * takes a ring except a drop target, where the edge is the whole message and
 * there is no text to carry it (decision 0063).
 *
 * A level of the tree indents by one fixed step and draws no guide line. The
 * steps stop at `deepestSteppedBranch`, so the column that holds a name has a
 * floor: every level used to add a step and nothing stopped it, so a folder
 * ten levels down in a narrow sidebar showed a chevron, a folder mark and no
 * name at all.
 *
 * Every token here is proved on every surface by `theme.test.ts` in
 * `packages/ui`: `textStrong` meets 4.5 to 1 on the sidebar surface and on
 * both fills, and `focus` meets the 3 to 1 non-text minimum.
 */
import { focusOutlineInset, rowClassName } from '@notesapp/ui';

/** What one row of the tree is right now. */
export type TreeRowState = {
  /** The row is the note that the screen next to the tree shows. */
  readonly open?: boolean | undefined;
  /** The row is the folder that a create action uses as its parent. */
  readonly selected?: boolean | undefined;
  /** A dragged row is over this row and it accepts the drop. */
  readonly dropTarget?: boolean | undefined;
};

/**
 * The classes of the container of one tree row.
 *
 * The container is the row: it carries the fill, the hover and the mark, and
 * the name control and the two icon actions sit inside it, so the pointer
 * answer covers the same box a person aims at. It is the `group` of the row,
 * which is what an action that appears on hover reads.
 */
export function treeRowClassName(state: TreeRowState = {}): string {
  const chosen =
    state.open !== true && state.selected === true
      ? 'bg-hover text-strong'
      : '';
  const drop = state.dropTarget === true ? 'ring-2 ring-inset ring-focus' : '';
  return rowClassName({
    selected: state.open === true,
    className: ['group pl-0 pr-1', chosen, drop]
      .filter((part) => part !== '')
      .join(' '),
  });
}

/**
 * The classes of the name control inside one tree row.
 *
 * The row decides the colour of the text, so the control inherits it and
 * states no colour of its own: a link in a browser paints itself until
 * something says otherwise. The control takes the inward focus outline,
 * because the tree is a box that scrolls and clips.
 */
export const treeRowNameClassName = `flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 truncate rounded-md border-0 bg-transparent px-1 text-left text-inherit no-underline ${focusOutlineInset}`;

/** The deepest branch that still steps in. */
export const deepestSteppedBranch = 4;

/**
 * The classes of one child branch of the tree, at `depth`.
 *
 * `depth` is 1 for the children of a folder at the top of the tree. One step
 * for each level is enough to read the shape of the tree, because folder and
 * note rows reserve the same disclosure column.
 */
export function treeBranchClassName(depth: number): string {
  return depth > deepestSteppedBranch ? '' : 'pl-3';
}
