import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachmentPreviewFailedMessage,
  attachmentPreviewView,
  idleAttachmentPreview,
} from './attachment-preview.ts';

const revisionId = 'revision-a';

await test('a failed read is not a version without a picture', () => {
  // The defect this covers: a failed read set the preview to nothing, and
  // nothing drew the same words as a version that truly holds no picture. A
  // version that does hold one therefore read as a version without one, so
  // the screen stated something false about the saved work.
  const view = attachmentPreviewView(
    { status: 'failed', revisionId },
    revisionId,
  );
  assert.equal(view.kind, 'failed');
});

await test('the failure states the cause and the action that helps', () => {
  assert.match(attachmentPreviewFailedMessage, /did not load/);
  assert.match(attachmentPreviewFailedMessage, /open the version again/);
});

await test('a picture that arrived is drawn', () => {
  const view = attachmentPreviewView(
    { status: 'ready', revisionId, url: 'blob:picture' },
    revisionId,
  );
  assert.deepEqual(view, { kind: 'picture', url: 'blob:picture' });
});

await test('a picture on its way is neither a picture nor a failure', () => {
  const view = attachmentPreviewView(
    { status: 'loading', revisionId },
    revisionId,
  );
  assert.equal(view.kind, 'loading');
});

await test('the state of another version says nothing about this one', () => {
  // A person who moves from one version to the next must not read the result
  // of the version they left.
  for (const preview of [
    { status: 'ready', revisionId: 'revision-b', url: 'blob:other' },
    { status: 'failed', revisionId: 'revision-b' },
  ] as const) {
    assert.equal(attachmentPreviewView(preview, revisionId).kind, 'loading');
  }
});

await test('no version open is not a failure', () => {
  assert.equal(
    attachmentPreviewView(idleAttachmentPreview, revisionId).kind,
    'loading',
  );
});
