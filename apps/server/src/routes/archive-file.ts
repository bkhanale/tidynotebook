/**
 * The file that holds one workspace archive while it is written or read.
 *
 * An archive of the largest export does not fit in memory, so the export
 * writes it to a file before it answers, and the import keeps the archive it
 * receives in a file while it reads it (issue 243). The file lives in the
 * temporary folder of the attachment store, on the data volume, and leaves the
 * folder as soon as it is open. The open handle keeps its bytes until it
 * closes, so no archive outlives its request, even when the process stops.
 *
 * The file is read and written through the handle alone. A stream of a file
 * handle holds a reference that only its own close gives back, so a handle
 * that one stream wrote and another read never closed.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import type { AttachmentStore } from '@notesapp/storage-server';

/** How many bytes one read of the file takes. */
const chunkBytes = 1024 * 1024;

/** Opens an empty archive file that no folder names. */
export async function openArchiveFile(
  attachments: AttachmentStore,
  kind: 'export' | 'import',
): Promise<FileHandle> {
  const path = attachments.temporaryPath(`${kind}-${randomUUID()}`);
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'w+', 0o600);
  await unlink(path);
  return handle;
}

/** Writes every chunk in order from the start of the file, and its size. */
export async function writeArchiveFile(
  handle: FileHandle,
  chunks: AsyncIterable<unknown>,
): Promise<number> {
  let size = 0;
  for await (const chunk of chunks) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    let done = 0;
    while (done < bytes.length) {
      const { bytesWritten } = await handle.write(
        bytes,
        done,
        bytes.length - done,
        size + done,
      );
      done += bytesWritten;
    }
    size += bytes.length;
  }
  return size;
}

/**
 * The first `size` bytes of the file as a stream, which closes the file when
 * it ends, fails, or when the reader leaves.
 */
export function readArchiveFile(handle: FileHandle, size: number): Readable {
  async function* chunks(): AsyncGenerator<Buffer> {
    let at = 0;
    while (at < size) {
      const buffer = Buffer.alloc(Math.min(chunkBytes, size - at));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, at);
      if (bytesRead === 0) return;
      at += bytesRead;
      yield buffer.subarray(0, bytesRead);
    }
  }
  const stream = Readable.from(chunks(), { objectMode: false });
  // The stream closes after its end, after a failure, and when the reader
  // leaves before the first byte, so the file closes in each of the three.
  stream.once('close', () => {
    void handle.close().catch(() => undefined);
  });
  return stream;
}
