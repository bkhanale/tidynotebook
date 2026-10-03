import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkdownLimitError } from '@notesapp/markdown';
import {
  classifyError,
  createProblem,
  DomainProblemError,
  ImportNoteRefusedError,
  PublishedLinkUnavailableError,
  RequestContractError,
  RequestMediaTypeError,
  ResponseContractError,
} from './problem.ts';

await test('a request contract failure becomes a 400 with its issues', () => {
  const classified = classifyError(
    new RequestContractError('query', [{ path: '/detail', message: 'bad' }]),
  );
  assert.equal(classified.status, 400);
  assert.equal(classified.code, 'invalid_request');
  assert.equal(classified.issues.length, 1);
});

await test('a response contract failure becomes a 500 without issues', () => {
  const classified = classifyError(
    new ResponseContractError(200, 'application/json'),
  );
  assert.equal(classified.status, 500);
  assert.equal(classified.code, 'invalid_response');
  assert.deepEqual(classified.issues, []);
});

await test('an oversized body becomes a 413', () => {
  const classified = classifyError({ code: 'FST_ERR_CTP_BODY_TOO_LARGE' });
  assert.equal(classified.status, 413);
  assert.equal(classified.code, 'payload_too_large');
});

await test('an unsupported media type becomes a 415', () => {
  for (const code of [
    'FST_ERR_CTP_INVALID_MEDIA_TYPE',
    'FST_ERR_CTP_EMPTY_TYPE',
  ]) {
    const classified = classifyError({ code });
    assert.equal(classified.status, 415);
    assert.equal(classified.code, 'unsupported_media_type');
  }
});

await test('a wrong request body media type becomes a 415', () => {
  const classified = classifyError(
    new RequestMediaTypeError('application/json'),
  );
  assert.equal(classified.status, 415);
  assert.equal(classified.code, 'unsupported_media_type');
  assert.match(classified.detail, /application\/json/);
});

await test('a note above the Markdown limits becomes a 422 for the author', () => {
  const cases = [
    ['note_too_large', 'This note is too large to render.'],
    ['note_too_deep', 'This note nests too deeply to render.'],
  ] as const;
  for (const [code, detail] of cases) {
    const classified = classifyError(
      new DomainProblemError({ code, fileIds: ['file-1'] }),
    );
    assert.equal(classified.status, 422);
    assert.equal(classified.code, 'unrenderable_note');
    assert.equal(classified.detail, detail);
    assert.deepEqual(classified.fileIds, ['file-1']);
  }
});

await test('a refused note of an import names the note and its own cause', () => {
  // Review of the audit of 2026-10-02. The import mapped every limit of the
  // grammar to a note that is too large, so a deep note read as a large one.
  const cases = [
    [
      'note_too_large',
      'The note "trip/Day 1" in the zip file is too large to show. Make the note smaller, then import again.',
    ],
    [
      'note_too_deep',
      'The note "trip/Day 1" in the zip file has too many levels of lists, quotes or HTML. Remove some levels, then import again.',
    ],
  ] as const;
  for (const [code, detail] of cases) {
    const classified = classifyError(
      new ImportNoteRefusedError(code, 'trip/Day 1.md'),
    );
    assert.equal(classified.status, 422);
    assert.equal(classified.code, 'unrenderable_note');
    assert.equal(classified.detail, detail);
    assert.doesNotMatch(classified.detail, /\.md|[\u2013\u2014]/);
  }
});

await test('a raw Markdown limit error never becomes a 500', () => {
  const cases = [
    ['input-size', 'This note is too large to render.'],
    ['nesting-depth', 'This note nests too deeply to render.'],
  ] as const;
  for (const [reason, detail] of cases) {
    const classified = classifyError(new MarkdownLimitError(reason, 100, 101));
    assert.equal(classified.status, 422);
    assert.equal(classified.code, 'unrenderable_note');
    assert.equal(classified.detail, detail);
    // The technical sentence of the package never reaches the author.
    assert.equal(classified.detail.includes('Markdown input'), false);
  }
});

await test('any other failure becomes a generic 500', () => {
  for (const error of [new Error('boom'), null, 'text', { code: 42 }]) {
    const classified = classifyError(error);
    assert.equal(classified.status, 500);
    assert.equal(classified.code, 'internal_error');
    assert.equal(classified.detail.includes('boom'), false);
  }
});

await test('a problem carries its issues only when there are some', () => {
  const base = {
    code: 'invalid_request',
    status: 400,
    detail: 'bad',
    instance: '/api/health',
    requestId: 'trace-1',
  } as const;
  assert.equal('issues' in createProblem(base), false);
  const withIssues = createProblem({
    ...base,
    issues: [{ path: '/detail', message: 'bad' }],
  });
  assert.equal(withIssues.issues?.length, 1);
  assert.equal(
    withIssues.type,
    'https://notesapp.invalid/problems/invalid_request',
  );
});

await test('the one reader refusal names no cause', () => {
  // Decision 0030. A missing link, a revoked link, an expired link and a
  // wrong password all raise this failure, and it takes no message, so no
  // caller can put a word in the answer that tells the four apart.
  const classified = classifyError(new PublishedLinkUnavailableError());
  assert.equal(classified.status, 404);
  assert.equal(classified.code, 'published_link_unavailable');
  assert.equal(classified.detail, 'This link is not available.');
  assert.deepEqual(classified.issues, []);
  assert.equal(classified.fileIds, undefined);
  const problem = createProblem({
    code: classified.code,
    status: classified.status,
    detail: classified.detail,
    instance: '/published/aaaaaaaaaaaaaaaaaaaaaa',
    requestId: 'trace-1',
  });
  assert.equal(problem.title, problem.detail);
  assert.equal(
    problem.type,
    'https://notesapp.invalid/problems/published_link_unavailable',
  );
});
