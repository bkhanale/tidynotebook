/**
 * The title of the browser tab.
 *
 * Every screen names itself, so a tab, a history entry, and an installed
 * window can be told apart. The application name always closes the title,
 * so a narrow tab still shows the part that changes.
 */
import { useEffect } from 'react';

/** The name of the application, as it closes every title. */
export const applicationName = 'Notesapp';

/** Joins a screen name and the application name into one tab title. */
export function documentTitle(screen: string | null): string {
  const trimmed = screen === null ? '' : screen.trim();
  return trimmed === '' ? applicationName : `${trimmed} - ${applicationName}`;
}

/** Sets the tab title for the screen that is open. */
export function useDocumentTitle(screen: string | null): void {
  useEffect(() => {
    document.title = documentTitle(screen);
  }, [screen]);
}
