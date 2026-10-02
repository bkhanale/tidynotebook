/**
 * A bounded reader for portable workspace ZIP archives.
 *
 * The bounds come from `@notesapp/core`, which the export writer reads too,
 * so every archive that an export writes is an archive that this reader
 * takes (issue 243). Every refusal is an `ArchiveRefusedError`, and its kind
 * names the real cause.
 *
 * The reader keeps the memory of the server bounded. It sums the sizes that
 * the entries state and refuses a total past `maxArchiveExpandedBytes` before
 * it expands one entry, and it expands each entry with that stated size as
 * the most output, so an entry that lies about its size stops at once.
 */
import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';
import {
  archiveEntriesAllowed,
  maxArchiveEntries,
  maxArchiveExpandedBytes,
} from '@notesapp/core';
import { ArchiveRefusedError } from '../plugins/problem.ts';

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

function endOffset(bytes: Buffer): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let at = bytes.length - 22; at >= minimum; at -= 1)
    if (bytes.readUInt32LE(at) === endSignature) return at;
  throw unreadable('The file is not a zip archive.');
}

/**
 * The file count of a ZIP64 archive, or `null` when the archive has none.
 *
 * An archive of more files than the 16 bit count holds states its count in a
 * ZIP64 record that a locator before the end record points at. This reader
 * reads no ZIP64 archive, but it reads that count, so an archive that is
 * refused for its size says so.
 */
function zip64Count(bytes: Buffer, end: number): number | null {
  const locator = end - 20;
  if (locator < 0 || bytes.readUInt32LE(locator) !== zip64LocatorSignature)
    return null;
  const record = Number(bytes.readBigUInt64LE(locator + 8));
  if (
    !Number.isSafeInteger(record) ||
    record + 56 > bytes.length ||
    bytes.readUInt32LE(record) !== zip64EndSignature
  )
    throw unreadable('The directory of the zip archive is not valid.');
  return Number(bytes.readBigUInt64LE(record + 32));
}

/** Reads regular file entries and refuses traversal, encryption, and ZIP64. */
export function unzipArchive(bytes: Buffer): readonly UnzipEntry[] {
  if (bytes.length < 22) throw unreadable('The file is not a zip archive.');
  const end = endOffset(bytes);
  const count = bytes.readUInt16LE(end + 10);
  const large = zip64Count(bytes, end);
  if (large !== null) {
    if (!archiveEntriesAllowed(large)) throw tooManyFiles();
    throw unreadable(
      'The zip archive uses ZIP64, which this server does not read.',
    );
  }
  if (!archiveEntriesAllowed(count)) throw tooManyFiles();
  if (count === countInZip64 && bytes.readUInt32LE(end + 16) === 0xffff_ffff)
    throw unreadable(
      'The zip archive uses ZIP64, which this server does not read.',
    );
  let at = bytes.readUInt32LE(end + 16);
  let expanded = 0;
  const result: UnzipEntry[] = [];
  const paths = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== centralSignature)
      throw unreadable('The directory of the zip archive is not valid.');
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const offset = bytes.readUInt32LE(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.length || offset + 30 > bytes.length)
      throw unreadable('The directory of the zip archive is not valid.');
    const path = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    at = next;
    if (path.endsWith('/')) continue;
    if (!safePath(path) || paths.has(path))
      throw unreadable(
        'The zip archive holds a file name that cannot be a note or an image.',
      );
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8))
      throw unreadable(
        'The zip archive is encrypted or compressed in a way that this server does not read.',
      );
    if (bytes.readUInt32LE(offset) !== localSignature)
      throw unreadable('A file of the zip archive is not valid.');
    const localNameLength = bytes.readUInt16LE(offset + 26);
    const localExtraLength = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + localNameLength + localExtraLength;
    const finish = start + compressedSize;
    if (finish > bytes.length)
      throw unreadable('A file of the zip archive is not complete.');
    expanded += size;
    if (expanded > maxArchiveExpandedBytes)
      throw new ArchiveRefusedError(
        'archive_too_large',
        `The files of one import hold ${String(maxArchiveExpandedBytes / (1024 * 1024))} MiB at the most. Split the files into smaller zip archives and import each one.`,
      );
    const content = bytes.subarray(start, finish);
    let uncompressed: Buffer;
    try {
      // The stated size is the most output, so an entry that expands past
      // what it states stops here and holds no more memory than it stated.
      uncompressed =
        method === 0
          ? Buffer.from(content)
          : inflateRawSync(content, { maxOutputLength: Math.max(1, size) });
    } catch {
      throw unreadable('A file of the zip archive is not valid.');
    }
    if (uncompressed.length !== size)
      throw unreadable('A file of the zip archive is not valid.');
    paths.add(path);
    result.push({ path, bytes: uncompressed });
  }
  return result;
}
