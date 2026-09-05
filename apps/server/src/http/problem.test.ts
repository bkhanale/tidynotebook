import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyError,
  createProblem,
  RequestContractError,
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
