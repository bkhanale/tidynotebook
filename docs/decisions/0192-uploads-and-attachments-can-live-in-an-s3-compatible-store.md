# 0192. Uploads and attachments can live in an S3 compatible store

- Status: Accepted
- Date: 2026-10-04

## Context

`openAttachmentStore` in `packages/storage-server/src/attachments.ts` keeps
each image under `NOTESAPP_STORAGE_ROOT`. `uploadAttachment` writes a
temporary file, and `finalizeAttachment` reads it in a second request, which
can reach another replica. `importWorkspace` takes the whole archive in one
request, and the Cloudflare proxy refuses a request body above `100 MB`.
Cloudflare R2 speaks the S3 API and charges no egress. See
[design 024](../design/024-tidy-notebook-cloud-and-self-hosted.md).

## Decision

- `packages/storage-server/src/object-store/` holds one port for every byte
  that outlives one request: write by key, read as a stream, state the size,
  promote a key to another, delete, the parts of a multipart upload, and a
  readiness probe. It has two adapters: the file store of today and an S3
  adapter on `@aws-sdk/client-s3`.
- **A staged upload.** `uploadAttachment` inspects the image on the local disk
  in its own request, then writes the checked bytes to a staging key of the
  store before it answers. `finalizeAttachment` promotes the staging key on
  any replica. The local disk holds a file for one request only.
- **An import in parts.** Three operations replace the single body of
  `importWorkspace`: start an import upload, send a part of at most `50 MB`,
  and complete it, which starts the import job of record 0170 on the stored
  archive. The S3 adapter uses a multipart upload, and the file adapter part
  files. The archive limit does not change.
- A daily job of the core removes each staging key and each unfinished
  multipart upload older than `1 day`, for both adapters.
- The metadata of each attachment stays in PostgreSQL. The reclaim queue, the
  digest and the deduplication do not change. The key of a finished object
  equals the relative path that the file store uses today.
- `NOTESAPP_OBJECT_STORE` is `filesystem`, the default, or `s3`. With `s3`,
  `NOTESAPP_S3_BUCKET`, `NOTESAPP_S3_REGION`, `NOTESAPP_S3_ENDPOINT` and the
  key pair of `NOTESAPP_S3_ACCESS_KEY_ID_FILE` and
  `NOTESAPP_S3_SECRET_ACCESS_KEY_FILE` name the store. The endpoint names R2,
  MinIO or AWS.
- The server streams each object to the reader. No presigned address leaves
  the server, so a revoked published link closes at once (record 0030), and
  record 0193 counts every byte and every operation.

## Consequences

- The cloud keeps its uploads and images in R2. A self-hosted installation
  can choose R2, MinIO or S3 with the same settings.
- One contract test of the port runs against both adapters, with a MinIO
  service in `compose.test.yaml` pinned by digest.
- An integration test uploads through one server instance and finalizes
  through another, and sends an import in parts across two instances.
