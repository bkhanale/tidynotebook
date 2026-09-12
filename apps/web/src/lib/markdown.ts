/**
 * The deferred math module of the web application.
 *
 * KaTeX is large, so the note screen imports this module only when it needs a
 * formula. The KaTeX stylesheet is imported here as well: KaTeX output is
 * absolutely positioned markup that needs those font faces and strut heights,
 * and without them a formula reads as a run of loose glyphs (MD-02).
 *
 * The stylesheet is a third-party file that belongs to the DOM this module
 * renders. No selector is written by hand here or anywhere else in the
 * application.
 */
import 'katex/dist/katex.min.css';

export { renderMath } from '@notesapp/markdown';
