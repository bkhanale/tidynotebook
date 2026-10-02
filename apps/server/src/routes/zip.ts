/**
 * A small ZIP writer for the export operations.
 *
 * The archive stores every entry uncompressed. A note is text that the person
 * asked to take away, and a stored entry needs no compressor state, so the
 * writer is a few record layouts and a checksum that `node:zlib` already
 * supplies. That keeps the export free of a third party archive library.
 *
 * The archive is produced as a stream: one entry is held in memory at a time,
 * and the central directory follows the entries, exactly as the format
 * prescribes. The format used here is the original one, not ZIP64, so an
 * archive is limited to `maxArchiveEntries` entries and to 4 GiB. A larger
 * export is refused rather than written wrong.
 */
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { maxArchiveEntries } from '@notesapp/core';

/** One stored file of the archive. */
export type ZipEntry = {
  /** The path inside the archive, with `/` separators and no leading slash. */
  readonly path: string;
  readonly bytes: Buffer;
  /** The modification instant that the archive records. */
  readonly modified: Date;
};

/**
 * How many bytes the original format can address.
 *
 * The most entries is `maxArchiveEntries` of `@notesapp/core`, which the
 * import reader reads too, so an archive that this writer writes is an
 * archive that an import takes (issue 243).
 */
const maxBytes = 0xffff_ffff;

/** Stored, not deflated. The reader needs no compressor for such an entry. */
const stored = 0;
/** Version 2.0 of the format, which is what a stored entry needs. */
const version = 20;
/** Bit 11 states that the file name is UTF-8. */
const utf8Names = 0x0800;

/** The MS-DOS date and time of one instant, as the format records it. */
function dosStamp(at: Date): { readonly date: number; readonly time: number } {
  const year = at.getUTCFullYear();
  // The format counts years from 1980 and cannot record anything earlier.
  if (year < 1980) return { date: (1 << 5) | 1, time: 0 };
  return {
    date:
      ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
    time:
      (at.getUTCHours() << 11) |
      (at.getUTCMinutes() << 5) |
      Math.floor(at.getUTCSeconds() / 2),
  };
}

/** The local header that comes before the bytes of one entry. */
function localHeader(
  name: Buffer,
  checksum: number,
  size: number,
  stamp: { readonly date: number; readonly time: number },
): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x0403_4b50, 0);
  header.writeUInt16LE(version, 4);
  header.writeUInt16LE(utf8Names, 6);
  header.writeUInt16LE(stored, 8);
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name]);
}

/** The central directory record of one entry. */
function centralHeader(
  name: Buffer,
  checksum: number,
  size: number,
  offset: number,
  stamp: { readonly date: number; readonly time: number },
): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x0201_4b50, 0);
  header.writeUInt16LE(version, 4);
  header.writeUInt16LE(version, 6);
  header.writeUInt16LE(utf8Names, 8);
  header.writeUInt16LE(stored, 10);
  header.writeUInt16LE(stamp.time, 12);
  header.writeUInt16LE(stamp.date, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

/** The record that closes the archive and locates the central directory. */
function endRecord(count: number, size: number, offset: number): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x0605_4b50, 0);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(size, 12);
  record.writeUInt32LE(offset, 16);
  return record;
}

/** Produces the archive bytes, one entry at a time. */
async function* archiveChunks(
  entries: AsyncIterable<ZipEntry>,
): AsyncGenerator<Buffer> {
  const directory: Buffer[] = [];
  let offset = 0;
  for await (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const checksum = crc32(entry.bytes);
    const stamp = dosStamp(entry.modified);
    const header = localHeader(name, checksum, entry.bytes.length, stamp);
    if (directory.length === maxArchiveEntries)
      throw new Error('notesapp: the export holds too many files.');
    if (offset + header.length + entry.bytes.length > maxBytes)
      throw new Error('notesapp: the export is too large for the format.');
    yield header;
    yield entry.bytes;
    directory.push(
      centralHeader(name, checksum, entry.bytes.length, offset, stamp),
    );
    offset += header.length + entry.bytes.length;
  }
  const central = Buffer.concat(directory);
  yield central;
  yield endRecord(directory.length, central.length, offset);
}

/** One readable ZIP archive of the given entries. */
export function zipArchive(entries: AsyncIterable<ZipEntry>): Readable {
  return Readable.from(archiveChunks(entries));
}
