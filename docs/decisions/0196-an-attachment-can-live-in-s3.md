# 0196. An attachment can live in S3

- Status: Accepted
- Date: 2026-10-04

## Context

`openAttachmentStore` in `packages/storage-server/src/attachments.ts` keeps
each finished image under `NOTESAPP_STORAGE_ROOT`, and the cloud runs several
processes on several hosts that must read every image. A shared network file
system costs more and is slower than object storage. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- `packages/storage-server/src/object-store/` holds one port for the bytes of
  a finished attachment: write once by key, read as a stream, state the size,
  delete, and a readiness probe. It has two adapters: the file store of today
  and an S3 adapter on `@aws-sdk/client-s3`.
- The metadata of each attachment stays in PostgreSQL. The reclaim queue, the
  digest and the deduplication do not change.
- A temporary upload, the inspection of an image and the body of an import
  stay on the local disk under `NOTESAPP_STORAGE_ROOT`, because each lives for
  one request.
- The key of an object equals the relative path that the file store uses, so
  an installation moves from one store to the other by copying the files.
- `NOTESAPP_OBJECT_STORE` is `filesystem`, the default, or `s3`. With `s3`,
  `NOTESAPP_S3_BUCKET` and `NOTESAPP_S3_REGION` are required, and
  `NOTESAPP_S3_ENDPOINT` names a store that is not AWS, such as MinIO. The
  credentials come from the default chain of the AWS SDK, which is the task
  role on ECS.
- The readiness probe of storage checks the bucket when the store is `s3`.
- The server streams each object to the reader, as now. No presigned address
  leaves the server, so a revoked published link closes at once (record 0030)
  and the transfer of record 0198 counts every byte.

## Consequences

- A self-hosted installation can choose S3 or MinIO with three settings.
- One contract test of the port runs against both adapters. `compose.test.yaml`
  adds a MinIO service pinned by digest for it.
