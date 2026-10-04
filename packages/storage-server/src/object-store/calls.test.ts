import assert from 'node:assert/strict';
import test from 'node:test';
import { s3CallKind } from './calls.ts';

await test('a put, a copy, a part and a list count as a write', () => {
  for (const command of [
    'PutObjectCommand',
    'CopyObjectCommand',
    'CreateMultipartUploadCommand',
    'UploadPartCommand',
    'CompleteMultipartUploadCommand',
    'ListObjectsV2Command',
    'ListPartsCommand',
  ])
    assert.equal(s3CallKind(command), 'write', command);
});

await test('a get and a head count as a read', () => {
  for (const command of [
    'GetObjectCommand',
    'HeadObjectCommand',
    'HeadBucketCommand',
  ])
    assert.equal(s3CallKind(command), 'read', command);
});

await test('a delete and an abort count as neither', () => {
  for (const command of [
    'DeleteObjectCommand',
    'DeleteObjectsCommand',
    'AbortMultipartUploadCommand',
    'an unknown command',
    undefined,
    7,
  ])
    assert.equal(s3CallKind(command), null, String(command));
});
