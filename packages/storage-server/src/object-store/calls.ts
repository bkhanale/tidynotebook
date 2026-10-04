/**
 * The calls of the S3 adapter that record 0193 counts.
 *
 * An S3 compatible store bills each call. Record 0193 counts a put, a copy,
 * a part and a list as a write, and a get and a head as a read, and a cap of
 * the installation bounds each of the two in a month. A delete and an abort
 * are counted as neither: Cloudflare R2 bills neither, and a cap that refused
 * them would keep bytes that a person removed.
 *
 * The file adapter makes no call to a service, so it counts nothing, and a
 * cap of object calls holds the S3 adapter only.
 */

/** The kind of one call to the object store. */
export type ObjectCallKind = 'write' | 'read';

/** What a store tells for each call that it makes. */
export type ObjectCallCounter = (kind: ObjectCallKind) => void;

/** The write calls, by the name of their command in the SDK. */
const writeCommands: ReadonlySet<string> = new Set([
  'PutObjectCommand',
  'CopyObjectCommand',
  'CreateMultipartUploadCommand',
  'UploadPartCommand',
  'UploadPartCopyCommand',
  'CompleteMultipartUploadCommand',
  'ListObjectsV2Command',
  'ListObjectsCommand',
  'ListPartsCommand',
  'ListMultipartUploadsCommand',
]);

/** The read calls, by the name of their command in the SDK. */
const readCommands: ReadonlySet<string> = new Set([
  'GetObjectCommand',
  'HeadObjectCommand',
  'HeadBucketCommand',
]);

/** The kind of one command of the SDK, or `null` for one that is free. */
export function s3CallKind(commandName: unknown): ObjectCallKind | null {
  if (typeof commandName !== 'string') return null;
  if (writeCommands.has(commandName)) return 'write';
  if (readCommands.has(commandName)) return 'read';
  return null;
}
