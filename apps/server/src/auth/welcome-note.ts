/**
 * The one note that a first run creates.
 *
 * The note is written once, during setup, through the same commit path that
 * the create operation uses. It therefore has a revision, a history entry and
 * a sync cursor, exactly like a note that a person made, and it reaches every
 * device. Nothing creates it a second time: setup runs only while no account
 * exists.
 *
 * The text lives here and not in the web application, because the web
 * application no longer offers a starter note.
 */
import {
  actionsForRole,
  commitChangeset,
  createFileChangeset,
  generateUUID,
  markdownContent,
  requestDigest,
  verifyActor,
  type WorkspaceStore,
} from '@notesapp/core';

/** The stored path of the welcome note, with the one Markdown suffix. */
export const welcomeNotePath = 'Welcome to Notesapp.md';

/** The Markdown of the welcome note. */
export const welcomeNoteText = `# Welcome to Notesapp

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

| Column | Meaning     |
| ------ | ----------- |
| Save   | One version |
| Draft  | This device |

## How saving works

Typing writes a draft on this device. **Save** makes one version on the
server, and History lists every version. The state chip in the header always
says where your work is.

Press Cmd or Ctrl and K to search your notes or to run an action.
`;

/**
 * Writes the welcome note into the workspace of the new owner.
 *
 * The call returns `false` when the note could not be written. Setup then
 * still succeeds: an account without the welcome note is a working
 * installation, and a failed seed must not remove the owner that was just
 * created.
 */
export async function seedWelcomeNote(
  store: WorkspaceStore,
  accountId: string,
  workspaceId: string,
): Promise<boolean> {
  const actor = verifyActor(accountId, [
    { workspaceId, actions: actionsForRole('owner') },
  ]);
  if (!actor.ok) return false;
  const fileId = generateUUID();
  const body = {
    fileId,
    revisionId: generateUUID(),
    path: welcomeNotePath,
    text: welcomeNoteText,
    mutationId: generateUUID(),
    deviceId: generateUUID(),
    clientTime: new Date().toISOString(),
  };
  const changeset = createFileChangeset({
    workspaceId,
    fileId,
    revisionId: body.revisionId,
    path: body.path,
    content: await markdownContent(body.text),
    message: null,
    ids: {
      mutationId: body.mutationId,
      deviceId: body.deviceId,
      clientTime: body.clientTime,
    },
  });
  const digest = await requestDigest(
    'createFile',
    { workspaceId, fileId, ifMatch: null },
    body,
  );
  const committed = await commitChangeset(
    store,
    actor.value,
    changeset,
    digest,
  );
  return committed.ok;
}
