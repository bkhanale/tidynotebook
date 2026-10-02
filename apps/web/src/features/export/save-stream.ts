/**
 * A file on the device that a download writes as it arrives (record 0170).
 *
 * The export of a workspace can be as large as the zip format allows, so a
 * browser that offers the File System Access API saves it as a stream into a
 * file that the person picks, and never holds the whole archive. A browser
 * without it saves a blob, which a large browser keeps on its disk.
 *
 * The picker opens on the click of the person, before the download starts,
 * because a browser opens it only during that gesture. The module reads the
 * API through property reads and checks each value, because the API is not
 * part of the standard types of the DOM.
 */

/** Where one download goes. */
export type SaveTarget =
  /** A file that the person picked, written as the bytes arrive. */
  | { readonly kind: 'stream'; readonly writable: WritableStream<Uint8Array> }
  /** The person closed the picker, so nothing downloads. */
  | { readonly kind: 'cancelled' }
  /** The browser has no picker, so the download becomes a blob. */
  | { readonly kind: 'blob' };

/** Whether a failure is the person closing the picker. */
function cancelled(failure: unknown): boolean {
  return (
    failure !== null &&
    typeof failure === 'object' &&
    Reflect.get(failure, 'name') === 'AbortError'
  );
}

/**
 * Opens the save picker of `scope`, the window, for a file named `name`.
 *
 * Any answer that is not a writable stream, and any failure other than a
 * closed picker, falls back to a blob, so a download never fails for the
 * sake of the picker.
 */
export async function pickSaveTarget(
  scope: object,
  name: string,
): Promise<SaveTarget> {
  const picker: unknown = Reflect.get(scope, 'showSaveFilePicker');
  if (typeof picker !== 'function') return { kind: 'blob' };
  try {
    const handle: unknown = await Reflect.apply(picker, scope, [
      {
        suggestedName: name,
        types: [
          {
            description: 'Zip file',
            accept: { 'application/zip': ['.zip'] },
          },
        ],
      },
    ]);
    if (handle === null || typeof handle !== 'object') return { kind: 'blob' };
    const create: unknown = Reflect.get(handle, 'createWritable');
    if (typeof create !== 'function') return { kind: 'blob' };
    const writable: unknown = await Reflect.apply(create, handle, []);
    return writable instanceof WritableStream
      ? { kind: 'stream', writable }
      : { kind: 'blob' };
  } catch (failure) {
    if (cancelled(failure)) return { kind: 'cancelled' };
    return { kind: 'blob' };
  }
}
