/** A bounded reader for portable workspace ZIP archives. */
import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';

export type UnzipEntry = {
  readonly path: string;
  readonly bytes: Buffer;
};

const endSignature = 0x0605_4b50;
const centralSignature = 0x0201_4b50;
const localSignature = 0x0403_4b50;
const maxEntries = 1000;
const maxExpandedBytes = 100 * 1024 * 1024;

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
  throw new Error('notesapp: the import is not a ZIP archive.');
}

/** Reads regular file entries and refuses traversal, encryption, and ZIP64. */
export function unzipArchive(bytes: Buffer): readonly UnzipEntry[] {
  if (bytes.length < 22)
    throw new Error('notesapp: the import is not a ZIP archive.');
  const end = endOffset(bytes);
  const count = bytes.readUInt16LE(end + 10);
  if (count > maxEntries)
    throw new Error('notesapp: the import holds too many files.');
  let at = bytes.readUInt32LE(end + 16);
  let expanded = 0;
  const result: UnzipEntry[] = [];
  const paths = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== centralSignature)
      throw new Error('notesapp: the import directory is not valid.');
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
      throw new Error('notesapp: the import directory is not valid.');
    const path = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    at = next;
    if (path.endsWith('/')) continue;
    if (!safePath(path) || paths.has(path))
      throw new Error('notesapp: the import holds an invalid path.');
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8))
      throw new Error('notesapp: the import uses an unsupported ZIP format.');
    if (bytes.readUInt32LE(offset) !== localSignature)
      throw new Error('notesapp: the import entry is not valid.');
    const localNameLength = bytes.readUInt16LE(offset + 26);
    const localExtraLength = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + localNameLength + localExtraLength;
    const finish = start + compressedSize;
    if (finish > bytes.length)
      throw new Error('notesapp: the import entry is incomplete.');
    expanded += size;
    if (expanded > maxExpandedBytes)
      throw new Error('notesapp: the import is too large.');
    const content = bytes.subarray(start, finish);
    const uncompressed =
      method === 0 ? Buffer.from(content) : inflateRawSync(content);
    if (uncompressed.length !== size)
      throw new Error('notesapp: the import entry size is not valid.');
    paths.add(path);
    result.push({ path, bytes: uncompressed });
  }
  return result;
}
