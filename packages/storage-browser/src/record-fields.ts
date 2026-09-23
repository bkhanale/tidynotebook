/**
 * The field readers of stored records.
 *
 * A stored record is local state that another application version, a partial
 * write, or a user tool may have touched, so every reader checks the shape it
 * returns and refuses a value that does not match with a `corrupt` failure.
 * The validators of `./migrations.ts` and `./legacy-records.ts` share these
 * readers, so one field reads the same way in both.
 */
import { LocalStorageError } from '@notesapp/sync';

/** Refuses a stored value that does not match its declared shape. */
export function corrupt(detail: string): never {
  throw new LocalStorageError('corrupt', detail);
}

/**
 * True when a stored value can be read and written by key.
 *
 * A migration step edits the stored record in place, so it cannot use
 * `object`, which copies. This guard proves only that the value holds
 * members; every member stays `unknown` until a reader checks it.
 */
export function isWritableRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The value as a plain record, or a refusal.
 *
 * Only own enumerable members are kept, so an inherited member of a value that
 * some other tool wrote cannot pass a check.
 */
export function object(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    corrupt(`${where} is not a record`);
  const members: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  return members;
}

export function text(
  row: Record<string, unknown>,
  field: string,
  where: string,
): string {
  const value: unknown = row[field];
  if (typeof value !== 'string') corrupt(`${where}.${field} is not text`);
  return value;
}

export function optionalText(
  row: Record<string, unknown>,
  field: string,
  where: string,
): string | null {
  const value: unknown = row[field];
  if (value === null) return null;
  if (typeof value !== 'string')
    corrupt(`${where}.${field} is not text or null`);
  return value;
}

/**
 * Text, or `null` for a field that a record written before it existed omits.
 *
 * A stored recovery record from an earlier release carries no server answer
 * code. Reading it must keep the kept text usable, so an absent field reads
 * as `null` instead of refusing the record.
 */
export function addedText(
  row: Record<string, unknown>,
  field: string,
  where: string,
): string | null {
  const value: unknown = row[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string')
    corrupt(`${where}.${field} is not text or null`);
  return value;
}

export function flag(
  row: Record<string, unknown>,
  field: string,
  where: string,
): boolean {
  const value: unknown = row[field];
  if (typeof value !== 'boolean') corrupt(`${where}.${field} is not a flag`);
  return value;
}

export function count(
  row: Record<string, unknown>,
  field: string,
  where: string,
): number {
  const value: unknown = row[field];
  if (typeof value !== 'number' || !Number.isFinite(value))
    corrupt(`${where}.${field} is not a finite number`);
  return value;
}

export function textList(
  row: Record<string, unknown>,
  field: string,
  where: string,
): readonly string[] {
  const value: unknown = row[field];
  if (!Array.isArray(value)) corrupt(`${where}.${field} is not a list`);
  const list: unknown[] = value;
  return list.map((entry: unknown, index: number) => {
    if (typeof entry !== 'string')
      corrupt(`${where}.${field}[${String(index)}] is not text`);
    return entry;
  });
}

export function member<T extends string>(
  row: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  where: string,
): T {
  const value: unknown = row[field];
  const found = allowed.find((entry) => entry === value);
  if (found === undefined)
    corrupt(`${where}.${field} is not one of the allowed values`);
  return found;
}

/** The three partition members every private row carries. */
export function partition(
  row: Record<string, unknown>,
  where: string,
): { serverOrigin: string; accountId: string; workspaceId: string } {
  return {
    serverOrigin: text(row, 'serverOrigin', where),
    accountId: text(row, 'accountId', where),
    workspaceId: text(row, 'workspaceId', where),
  };
}

/** Reads one stored byte string, or refuses the row. */
export function byteString(
  row: Record<string, unknown>,
  name: string,
  table: string,
): Uint8Array {
  const value = row[name];
  if (value instanceof Uint8Array) return value;
  // A structured clone can return an ArrayBuffer for bytes that an older
  // engine stored, so the value is read and never asserted.
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new LocalStorageError('corrupt', `${table}.${name} is not bytes`);
}

/**
 * Bytes, or `null` for a field that a record written before it existed omits.
 *
 * A staged snapshot item of an earlier release carries no document, and the
 * item of an attachment never carries one.
 */
export function addedBytes(
  row: Record<string, unknown>,
  name: string,
  table: string,
): Uint8Array | null {
  const value: unknown = row[name];
  if (value === undefined || value === null) return null;
  return byteString(row, name, table);
}

/** A number, or `null` for a field that a record omits. */
export function addedCount(
  row: Record<string, unknown>,
  name: string,
  table: string,
): number | null {
  const value: unknown = row[name];
  if (value === undefined || value === null) return null;
  return count(row, name, table);
}
