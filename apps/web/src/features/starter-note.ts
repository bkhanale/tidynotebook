/**
 * The note a first run offers.
 *
 * It is a short Markdown note that shows what the editor can do, so the
 * first screen a person meets is a note and not an empty page. Every line
 * is plain Markdown; opening it teaches the syntax by showing the result.
 */

/** The name of the starter note, without the storage suffix. */
export const starterNoteName = 'Welcome to Notesapp';

/** The stored path of the starter note. */
export const starterNotePath = `${starterNoteName}.md`;

/** The Markdown of the starter note. */
export const starterNoteText = `# Welcome to Notesapp

This is a Markdown note. Type in it and the text stays editable while it
shows the result.

## What you can write

- **Bold** and _italic_ text
- A list, like this one
- [ ] A task box. Press Cmd or Ctrl and Enter on this line.
- A [link](https://commonmark.org) to a page
- \`inline code\`, and a fenced block:

\`\`\`ts
const greeting = 'hello';
\`\`\`

> A quote reads like this.

| Column | Meaning        |
| ------ | -------------- |
| Save   | One version    |
| Draft  | This device    |

## How saving works

Typing writes a draft on this device. **Save** makes one version on the
server, and History lists every version. The state chip in the header always
says where your work is.

Press Cmd or Ctrl and K to search your notes or to run an action.
`;
