/**
 * Where the person is, as the parts of one breadcrumb.
 *
 * The frame header is the context of the route (decision 0064), and the
 * breadcrumb is the part that states it: the workspace a person works under,
 * then the folders of the open note, then the name of the note or the page.
 *
 * This module decides the parts and which of them is a link. It does not
 * decide their words: the name of a workspace comes from the workspace list
 * and the name of a page comes from the screen that owns it, so each of those
 * facts stays where it already lives and the caller passes the last part in.
 *
 * Every part but the last is a link, because the last part is where the
 * person already is. A folder part goes to the note list of the workspace and
 * selects that folder, which is what the folder row of the tree does, so the
 * two surfaces agree on what pressing a folder means.
 */

/** One part of the breadcrumb. */
export type BreadcrumbPart = {
  readonly label: string;
  /** Where the part goes, or `null` when the part is where you are. */
  readonly to: string | null;
  /** The folder the part selects in the tree, or `null` when it selects none. */
  readonly folder: string | null;
};

/** What the frame is showing right now. */
export type BreadcrumbRoute = {
  readonly workspaceId: string;
  /** The name of the open workspace, which is the first part. */
  readonly workspaceName: string;
  /** The stored path of the note the route names, or `null` for a page. */
  readonly notePath: string | null;
  /** The name of the note or the page, which is the last part. */
  readonly leaf: string;
};

/** The address of the note list of one workspace. */
function workspaceHome(workspaceId: string): string {
  return `/w/${workspaceId}`;
}

/**
 * The parts of the breadcrumb of one route.
 *
 * A note inside a folder yields one part for each folder above it, so the
 * person reads the whole path and can reach every level of it. A route that
 * names no note yields the workspace and the page, which is the shortest
 * breadcrumb the header ever shows.
 */
export function breadcrumbParts(
  route: BreadcrumbRoute,
): readonly BreadcrumbPart[] {
  const home = workspaceHome(route.workspaceId);
  const parts: BreadcrumbPart[] = [
    { label: route.workspaceName, to: home, folder: '' },
  ];
  const segments =
    route.notePath === null ? [] : route.notePath.split('/').slice(0, -1);
  let walked = '';
  for (const segment of segments) {
    if (segment === '') continue;
    walked = walked === '' ? segment : `${walked}/${segment}`;
    parts.push({ label: segment, to: home, folder: walked });
  }
  parts.push({ label: route.leaf, to: null, folder: null });
  return parts;
}
