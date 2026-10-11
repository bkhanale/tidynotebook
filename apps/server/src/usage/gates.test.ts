/**
 * The gates of record 0193 against the contract.
 *
 * `packages/core` holds the one list of the operations that a closure of the
 * month refuses, and it imports no contract. This server reads both, so it
 * holds the list to the contract here: a name that the contract does not
 * declare fails, a gate whose refusal the operation cannot answer fails, and
 * an operation of a session that sends stored bytes and that no gate names
 * fails, so a new download cannot pass the download limit by mistake.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { operations, responseMediaTypes } from '@notesapp/api-contract';
import { usageGateOf, usageGates } from '@notesapp/core';

/** The media types of an answer that carries stored bytes. */
const downloadMediaTypes = new Set([
  'application/zip',
  'application/octet-stream',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

await test('every operation that a gate names is one of the contract', () => {
  for (const id of Object.keys(usageGates))
    assert.ok(
      operations.some((operation) => operation.id === id),
      `${id} is not an operation of the contract`,
    );
});

await test('every gated operation can answer its refusal', () => {
  for (const [id, gate] of Object.entries(usageGates)) {
    const operation = operations.find((entry) => entry.id === id);
    if (operation === undefined) continue;
    const status = gate === 'upload' ? 503 : 429;
    assert.deepEqual(
      responseMediaTypes(operation.id, status),
      ['application/problem+json'],
      `${id} declares no ${String(status)}, so its refusal would be a server error`,
    );
  }
});

await test('every download of a session passes a gate', () => {
  const downloads = operations.filter(
    (operation) =>
      operation.security.some(
        (requirement) => 'sessionCookie' in requirement,
      ) &&
      operation.responses.some(
        (response) =>
          response.status === 200 && downloadMediaTypes.has(response.mediaType),
      ),
  );
  assert.ok(downloads.some((operation) => operation.id === 'exportWorkspace'));
  for (const operation of downloads)
    assert.notEqual(usageGateOf(operation.id), null, operation.id);
});

await test('a small answer of the API and a sync change pass no gate', () => {
  for (const id of [
    'getAccount',
    'getChanges',
    'getRevision',
    'commitChangeset',
    'listFiles',
    'finalizeAttachment',
    'abortWorkspaceImport',
  ])
    assert.equal(usageGateOf(id), null, id);
});
