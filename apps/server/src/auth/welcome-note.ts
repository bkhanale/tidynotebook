/**
 * The first note of a personal workspace. A durable completion record lets
 * locked accounts wait until activation without creating the note twice.
 */
import {
  actionsForRole,
  completeWelcomeNote,
  createFileChangeset,
  generateUUID,
  workspaceText,
  requestDigest,
  verifyActor,
  type WelcomeNoteStore,
  productName,
} from '@notesapp/core';

/** The stored path of the welcome note, with the one Markdown suffix. */
export const welcomeNotePath = `Welcome to ${productName}.md`;

/** The Markdown of the welcome note. */
export const welcomeNoteText = `# Welcome to ${productName}

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

| Action | Result            |
| ------ | ----------------- |
| Type   | Keeps a draft     |
| Pause  | Creates a version |

## How saving works

Typing writes a draft on this device. A short pause creates a version on the
server. History lists each version.

Press Cmd or Ctrl and P to search your notes or to run an action.
`;

const completedWorkspaces = new WeakMap<WelcomeNoteStore, Set<string>>();

/**
 * Attempts the pending note. A refused write stays pending. Only a safe code
 * reaches the failure reporter, including for an unexpected exception.
 */
export async function seedWelcomeNote(
  store: WelcomeNoteStore,
  accountId: string,
  workspaceId: string,
  reportFailure: (code: string) => void,
): Promise<boolean> {
  if (completedWorkspaces.get(store)?.has(workspaceId) === true) return true;
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
    content: workspaceText(body.text, 1),
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
  try {
    const committed = await completeWelcomeNote(
      store,
      actor.value,
      changeset,
      digest,
    );
    if (
      committed.ok &&
      (committed.value === 'created' || committed.value === 'completed')
    ) {
      let completed = completedWorkspaces.get(store);
      if (completed === undefined) {
        completed = new Set();
        completedWorkspaces.set(store, completed);
      }
      completed.add(workspaceId);
    }
    if (!committed.ok) reportFailure(committed.error.code);
    return committed.ok;
  } catch {
    reportFailure('unexpected');
    return false;
  }
}
