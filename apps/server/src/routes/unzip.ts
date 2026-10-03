/**
 * A bounded reader for portable workspace ZIP archives.
 *
 * The bounds come from `@notesapp/core`, which the export writer reads too,
 * so every archive that an export writes is an archive that this reader
 * takes (issue 243). Every refusal is an `ArchiveRefusedError`, and its kind
 * names the real cause.
 *
 * The reader works on an `ArchiveSource`, which reads a range of bytes. The
 * import keeps the archive in a file and reads it through one, so an archive
 * of the largest size never sits in memory. `readArchiveDirectory` reads the
 * central directory and checks every entry before any entry expands:
 *
 * - a stored entry states as many compressed bytes as expanded ones, and a
 *   deflated one no more than the bound of deflate for its size, so no entry
 *   asks for more memory than its expanded size allows;
 * - the data of each entry sits whole between its local header and the
 *   central directory, and no two entries share a byte;
 * - the stated sizes together stay under `maxArchiveBytes` and under
 *   `maxExpansionRatio` times the archive, with a floor for a small archive;
 * - no name is longer than `maxPathBytes`, which no workspace path passes.
 *   The check reads the stated length before it decodes the name, so the
 *   names that the reader keeps stay under that bound times the count. The
 *   extra field and the comment of an entry are read past and never kept.
 *
 * `readArchiveEntry` expands one entry as a stream, from a bounded range of
 * the source, and stops as soon as the output passes its stated size, so the
 * work runs off the event loop and an entry that lies stops at once.
 */
import { Buffer } from 'node:buffer';
import type { FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import {
  archiveBytesAllowed,
  archiveEntriesAllowed,
  maxArchiveBytes,
  maxArchiveEntries,
  maxPathBytes,
} from '@notesapp/core';
import { ArchiveRefusedError } from '../plugins/problem.ts';

/** One read range of an archive. */
export type ArchiveSource = {
  /** The length of the archive in bytes. */
  readonly size: number;
  /** Reads `length` bytes at `offset`. A read past the end gives fewer. */
  read(offset: number, length: number): Promise<Buffer>;
};

/** One file of an archive, as its central directory states it. */
export type ArchiveEntry = {
  readonly path: string;
  /** 0 for a stored entry, 8 for a deflated one. */
  readonly method: number;
  readonly compressedSize: number;
  /** The size that the entry states for its expanded bytes. */
  readonly size: number;
  /** The offset of the local header of the entry. */
  readonly offset: number;
  /** The offset of the first byte of the data of the entry. */
  readonly dataOffset: number;
};

/** One expanded file of an archive. */
export type UnzipEntry = {
  readonly path: string;
  readonly bytes: Buffer;
};

const endSignature = 0x0605_4b50;
const zip64LocatorSignature = 0x0706_4b50;
const zip64EndSignature = 0x0606_4b50;
const centralSignature = 0x0201_4b50;
const localSignature = 0x0403_4b50;

/** The value that a 16 bit count holds when the real count is in ZIP64. */
const countInZip64 = 0xffff;

/** The most bytes that the end of an archive takes: its record and comment. */
const endSearchBytes = 65_557;

/** How many bytes of the directory, or of one entry, one read takes. */
const directoryChunkBytes = 1024 * 1024;

/**
 * How many times its own size the files of an archive may hold together.
 *
 * Text deflates to a fraction of its size, and an archive that expands much
 * further than text does is a bomb. A small archive may hold up to
 * `minimumExpansionBytes` whatever its ratio.
 */
export const maxExpansionRatio = 100;
const minimumExpansionBytes = 64 * 1024 * 1024;

/**
 * The most compressed bytes that deflate writes for `size` bytes.
 *
 * It is the bound of zlib, `deflateBound`, with room for the header of a
 * writer of another kind. A writer that cannot compress a block stores it,
 * so no valid entry passes this.
 */
export function deflatedBound(size: number): number {
  return (
    size +
    Math.floor(size / 4096) +
    Math.floor(size / 16_384) +
    Math.floor(size / 33_554_432) +
    13 +
    1024
  );
}

/** A source over bytes in memory, for a small archive and for a test. */
export function bufferSource(bytes: Buffer): ArchiveSource {
  return {
    size: bytes.length,
    read: (offset, length) =>
      Promise.resolve(
        bytes.subarray(
          Math.min(offset, bytes.length),
          Math.min(offset + length, bytes.length),
        ),
      ),
  };
}

/** A source over an open file of `size` bytes. */
export function fileSource(handle: FileHandle, size: number): ArchiveSource {
  return {
    size,
    read: async (offset, length) => {
      const wanted = Math.max(0, Math.min(length, size - offset));
      const buffer = Buffer.alloc(wanted);
      let done = 0;
      while (done < wanted) {
        const { bytesRead } = await handle.read(
          buffer,
          done,
          wanted - done,
          offset + done,
        );
        if (bytesRead === 0) break;
        done += bytesRead;
      }
      return buffer.subarray(0, done);
    },
  };
}

/** The refusal of an archive that this reader cannot read. */
function unreadable(detail: string): ArchiveRefusedError {
  return new ArchiveRefusedError('archive_invalid', detail);
}

/** The refusal of an archive with more files than one import takes. */
function tooManyFiles(): ArchiveRefusedError {
  return new ArchiveRefusedError(
    'archive_too_many_files',
    `One import takes ${String(maxArchiveEntries)} files at the most. Split the files into smaller zip archives and import each one.`,
  );
}

/** The refusal of an archive whose files hold more bytes than it may. */
export function tooLarge(): ArchiveRefusedError {
  return new ArchiveRefusedError(
    'archive_too_large',
    `The files of one import hold ${String(Math.floor(maxArchiveBytes / (1024 * 1024)))} MiB at the most. Split the files into smaller zip archives and import each one.`,
  );
}

/** The refusal of a name that no file of a workspace can take. */
function unsafeName(): ArchiveRefusedError {
  return unreadable(
    'The zip archive holds a file name that cannot be a note or an image.',
  );
}

function safePath(path: string): boolean {
  if (
    path === '' ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0')
  )
    return false;
  const parts = path.split('/');
  return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

/** Reads exactly `length` bytes at `offset`, or refuses the archive. */
async function readExactly(
  source: ArchiveSource,
  offset: number,
  length: number,
  what: string,
): Promise<Buffer> {
  const bytes = await source.read(offset, length);
  if (bytes.length !== length) throw unreadable(what);
  return bytes;
}

/**
 * The count of a ZIP64 archive, or `null` when the archive has none.
 *
 * An archive of more files than the 16 bit count holds states its count in a
 * ZIP64 record that a locator before the end record points at. This reader
 * reads no ZIP64 archive, but it reads that count, so an archive that is
 * refused for its size says so.
 */
async function zip64Count(
  source: ArchiveSource,
  end: number,
): Promise<number | null> {
  const at = end - 20;
  if (at < 0) return null;
  const locator = await source.read(at, 20);
  if (
    locator.length !== 20 ||
    locator.readUInt32LE(0) !== zip64LocatorSignature
  )
    return null;
  const offset = Number(locator.readBigUInt64LE(8));
  const invalid = 'The directory of the zip archive is not valid.';
  if (!Number.isSafeInteger(offset)) throw unreadable(invalid);
  const record = await readExactly(source, offset, 56, invalid);
  if (record.readUInt32LE(0) !== zip64EndSignature) throw unreadable(invalid);
  return Number(record.readBigUInt64LE(32));
}

/** The offset of the end record of the archive. */
async function endOffset(source: ArchiveSource): Promise<number> {
  if (source.size < 22) throw unreadable('The file is not a zip archive.');
  const start = Math.max(0, source.size - endSearchBytes);
  const tail = await source.read(start, source.size - start);
  for (let at = tail.length - 22; at >= 0; at -= 1)
    if (tail.readUInt32LE(at) === endSignature) return start + at;
  throw unreadable('The file is not a zip archive.');
}

/** Reads the bytes of the directory in order, one chunk at a time. */
function sequentialReader(
  source: ArchiveSource,
  start: number,
): (length: number) => Promise<Buffer> {
  let buffer = Buffer.alloc(0);
  let next = start;
  return async (length) => {
    while (buffer.length < length) {
      const chunk = await source.read(
        next,
        Math.max(directoryChunkBytes, length),
      );
      if (chunk.length === 0)
        throw unreadable('The directory of the zip archive is not valid.');
      next += chunk.length;
      buffer = Buffer.concat([buffer, chunk]);
    }
    const taken = buffer.subarray(0, length);
    buffer = buffer.subarray(length);
    return taken;
  };
}

/**
 * Every file of an archive, from its central directory, checked.
 *
 * The count, each path, the format of each entry, and the sum of the stated
 * sizes are checked here, so an import refuses an archive before it writes
 * any file of it. A folder entry is not a file and is left out.
 */
export async function readArchiveDirectory(
  source: ArchiveSource,
): Promise<readonly ArchiveEntry[]> {
  if (!archiveBytesAllowed(source.size)) throw tooLarge();
  const end = await endOffset(source);
  const record = await readExactly(
    source,
    end,
    22,
    'The file is not a zip archive.',
  );
  const count = record.readUInt16LE(10);
  const large = await zip64Count(source, end);
  if (large !== null) {
    if (!archiveEntriesAllowed(large)) throw tooManyFiles();
    throw unreadable(
      'The zip archive uses ZIP64, which this server does not read.',
    );
  }
  if (!archiveEntriesAllowed(count)) throw tooManyFiles();
  const directoryOffset = record.readUInt32LE(16);
  if (count === countInZip64 && directoryOffset === 0xffff_ffff)
    throw unreadable(
      'The zip archive uses ZIP64, which this server does not read.',
    );
  if (directoryOffset > source.size)
    throw unreadable('The directory of the zip archive is not valid.');
  const take = sequentialReader(source, directoryOffset);
  const expansionBound = Math.max(
    minimumExpansionBytes,
    maxExpansionRatio * source.size,
  );
  let expanded = 0;
  const entries: ArchiveEntry[] = [];
  const paths = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const header = await take(46);
    if (header.readUInt32LE(0) !== centralSignature)
      throw unreadable('The directory of the zip archive is not valid.');
    const flags = header.readUInt16LE(8);
    const method = header.readUInt16LE(10);
    const compressedSize = header.readUInt32LE(20);
    const size = header.readUInt32LE(24);
    const nameLength = header.readUInt16LE(28);
    const extraLength = header.readUInt16LE(30);
    const commentLength = header.readUInt16LE(32);
    const offset = header.readUInt32LE(42);
    if (nameLength > maxPathBytes) throw unsafeName();
    const rest = await take(nameLength + extraLength + commentLength);
    const path = rest.toString('utf8', 0, nameLength);
    if (offset + 30 > source.size)
      throw unreadable('The directory of the zip archive is not valid.');
    if (path.endsWith('/')) continue;
    if (!safePath(path) || paths.has(path)) throw unsafeName();
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8))
      throw unreadable(
        'The zip archive is encrypted or compressed in a way that this server does not read.',
      );
    const fits =
      method === 0
        ? compressedSize === size
        : compressedSize <= deflatedBound(size);
    if (!fits)
      throw unreadable(
        'A file of the zip archive states sizes that do not fit.',
      );
    expanded += size;
    if (!archiveBytesAllowed(expanded) || expanded > expansionBound)
      throw tooLarge();
    paths.add(path);
    entries.push({ path, method, compressedSize, size, offset, dataOffset: 0 });
  }
  // The data of each entry must sit whole before the central directory, and
  // no two entries may share a byte: an archive that points two entries at
  // one deflated stream expands it twice for the cost of once.
  const placed: ArchiveEntry[] = [];
  for (const entry of entries) {
    const local = await readExactly(
      source,
      entry.offset,
      30,
      'A file of the zip archive is not valid.',
    );
    if (local.readUInt32LE(0) !== localSignature)
      throw unreadable('A file of the zip archive is not valid.');
    const dataOffset =
      entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    if (dataOffset + entry.compressedSize > directoryOffset)
      throw unreadable('A file of the zip archive is not complete.');
    placed.push({ ...entry, dataOffset });
  }
  const ordered = [...placed].sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < ordered.length; index += 1) {
    const before = ordered[index - 1];
    const after = ordered[index];
    if (
      before !== undefined &&
      after !== undefined &&
      after.offset < before.dataOffset + before.compressedSize
    )
      throw unreadable('Two files of the zip archive share their bytes.');
  }
  return placed;
}

/** The bytes of one range of the source, one bounded read at a time. */
async function* rangeChunks(
  source: ArchiveSource,
  start: number,
  length: number,
): AsyncGenerator<Buffer> {
  let at = start;
  const end = start + length;
  while (at < end) {
    const wanted = Math.min(directoryChunkBytes, end - at);
    yield await readExactly(
      source,
      at,
      wanted,
      'A file of the zip archive is not complete.',
    );
    at += wanted;
  }
}

/**
 * The expanded bytes of one entry of `readArchiveDirectory`.
 *
 * A deflated entry expands as a stream in the thread pool of `node:zlib`, and
 * the read stops as soon as the output passes the stated size.
 */
export async function readArchiveEntry(
  source: ArchiveSource,
  entry: ArchiveEntry,
): Promise<Buffer> {
  const output: Buffer[] = [];
  let total = 0;
  const collect = async (chunks: AsyncIterable<unknown>): Promise<void> => {
    for await (const chunk of chunks) {
      if (!Buffer.isBuffer(chunk))
        throw unreadable('A file of the zip archive is not valid.');
      total += chunk.length;
      if (total > entry.size)
        throw unreadable('A file of the zip archive is not valid.');
      output.push(chunk);
    }
  };
  const range = Readable.from(
    rangeChunks(source, entry.dataOffset, entry.compressedSize),
  );
  try {
    if (entry.method === 0) await collect(range);
    else await pipeline(range, createInflateRaw(), collect);
  } catch (error) {
    if (error instanceof ArchiveRefusedError) throw error;
    throw unreadable('A file of the zip archive is not valid.');
  }
  if (total !== entry.size)
    throw unreadable('A file of the zip archive is not valid.');
  return Buffer.concat(output, total);
}

/** Every file of a small archive in memory, in directory order. */
export async function unzipArchive(
  bytes: Buffer,
): Promise<readonly UnzipEntry[]> {
  const source = bufferSource(bytes);
  const result: UnzipEntry[] = [];
  for (const entry of await readArchiveDirectory(source))
    result.push({
      path: entry.path,
      bytes: await readArchiveEntry(source, entry),
    });
  return result;
}
