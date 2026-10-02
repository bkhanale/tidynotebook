/**
 * The one script of a published page (records 0158 and 0174).
 *
 * The server writes a published page with no script, and it names this file
 * only when the note holds a diagram or a code block. The content policy of
 * that page names this file by its exact address, and the frame document of a
 * diagram only for a note that holds one, so nothing else runs. The build
 * emits this module alone, with no import, as
 * `assets/published-page-<hash>.js` (`publishedPageScript` in
 * `apps/web/vite.config.ts`).
 *
 * With no script, a reader reads the source of each diagram and each code
 * block with its language.
 */
import { startCodeCopy } from './code-copy.ts';
import { startDiagrams } from './diagrams.ts';

startDiagrams();
startCodeCopy();
