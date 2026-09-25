/**
 * Which view the sidebar shows (record 0105).
 *
 * The sidebar shows one view at a time, and the bar at its left edge holds
 * one button for each view. The view is a choice of this person on this
 * device, so it lives in browser settings beside the width of the sidebar.
 * Everything here is pure, so the rules are tested without a browser.
 */

/** Every view of the sidebar, in the order of the bar. */
export const sidebarViews = ['notes', 'calendar'] as const;

/** One view of the sidebar. */
export type SidebarView = (typeof sidebarViews)[number];

/** The view that a new installation opens with. */
export const defaultSidebarView: SidebarView = 'notes';

/** The local settings key of the view. */
export const sidebarViewStorageKey = 'notesapp.sidebar-view';

/** The name of each view, which its button reads as label and title. */
export const sidebarViewLabels: Readonly<Record<SidebarView, string>> = {
  notes: 'Notes',
  calendar: 'Calendar',
};

/** Reads one stored view, and falls back to the default for anything else. */
export function parseSidebarView(stored: string | null): SidebarView {
  return sidebarViews.find((view) => view === stored) ?? defaultSidebarView;
}
