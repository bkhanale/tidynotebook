/**
 * The file that holds one workspace archive while an import reads it.
 *
 * An archive of the largest export does not fit in memory, so the import
 * keeps the archive it receives in a file while it reads it (issue 243). The
 * file lives in the temporary folder of the attachment store, on the data
 * volume, and leaves the folder as soon as it is open. The open handle keeps
 * its bytes until it closes, so no archive outlives its request, even when the
 * process stops.
 *
 * The file is written through the handle alone. A stream of a file handle
 * holds a reference that only its own close gives back, so a handle that one
 * stream wrote never closed.
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AttachmentStore } from '@notesapp/storage-server';

/** Opens an empty archive file that no folder names. */
export async function openArchiveFile(
  attachments: AttachmentStore,
  kind: 'import',
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
