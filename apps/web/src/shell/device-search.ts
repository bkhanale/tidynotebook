/**
 * The search of this device, which the command palette loads with its first
 * search (record 0177).
 *
 * `searchLocal` reads the plain text of each note through the Markdown parser
 * of `@notesapp/markdown`. A static import from the palette put that parser
 * and the HTML reader under it into the first screen.
 */
export { searchLocal } from '@notesapp/sync';
