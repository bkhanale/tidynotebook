/**
 * The settings that one member keeps in one workspace, as this device holds
 * them (records 0099 and 0149).
 *
 * The daily note settings and the template settings are two settings of one
 * kind: the server is the source, and this device keeps the last answer in
 * browser settings for a start with no connection. Each setting states how it
 * reads, writes and caches itself as one `MemberSettingsSource`, and the one
 * hook of `shell/member-settings.ts` does the rest. The rules here are pure,
 * so they are tested without a browser.
 */

/** Where the settings of the member stand. */
export type MemberSettingsState<T> =
  | { readonly status: 'loading' }
  /** No answer of the server and no copy on this device. */
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly settings: T };

/** One answer of the server to a read or a write of a setting. */
export type SettingsAnswer<T> =
  | { readonly kind: 'stored'; readonly settings: T }
  | {
      readonly kind: 'refused';
      /** The status of the answer, or `0` when no answer came. */
      readonly status: number;
      readonly error: unknown;
    };

/** How one setting of a member reads, writes and caches itself. */
export type MemberSettingsSource<T> = {
  /** The name of the setting in its browser settings key. */
  readonly name: string;
  /** Reads the stored settings through a generated operation. */
  readonly read: (workspaceId: string) => Promise<SettingsAnswer<T>>;
  /** Replaces the stored settings through a generated operation. */
  readonly write: (
    workspaceId: string,
    settings: T,
  ) => Promise<SettingsAnswer<T>>;
  /** The text that this device keeps for one answer. */
  readonly encode: (settings: T) => string;
  /** The settings of a kept copy, or `null` when the copy does not parse. */
  readonly decode: (source: string | null) => T | null;
  /** The one sentence of a write that the server answered and refused. */
  readonly refusal: (status: number, error: unknown) => string;
};

/**
 * The one sentence of a change of a setting that reached no server.
 *
 * With no answer at all the setting is not kept anywhere, which the general
 * sentence of an unreachable server does not say. Every setting reads this
 * one sentence, so the hook states it and no source repeats it.
 */
export const memberSettingsUnsent =
  'The setting did not reach the server. Try again when you are online.';

/** The one sentence of a refused change of a setting. */
export function refusalSentence<T>(
  source: MemberSettingsSource<T>,
  answer: { readonly status: number; readonly error: unknown },
): string {
  return answer.status === 0
    ? memberSettingsUnsent
    : source.refusal(answer.status, answer.error);
}

/** The browser settings key of one setting of one member. */
export function memberSettingsKey(
  name: string,
  accountId: string,
  workspaceId: string,
): string {
  return `notesapp.${name}:${accountId}:${workspaceId}`;
}

/**
 * The members of a kept copy, or `null` when the copy is no object.
 *
 * Another page of this origin can write the same key, so a setting checks
 * every member it reads, and a copy of another shape is no copy at all.
 */
export function cachedObject(
  source: string | null,
): Readonly<Record<string, unknown>> | null {
  if (source === null || source === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return null;
  return Object.fromEntries(Object.entries(value));
}

/** The shape of the result of a generated operation that this module reads. */
type OperationResult<D> = {
  readonly data?: D | undefined;
  readonly error?: unknown;
  readonly response?: { readonly status: number } | undefined;
};

/**
 * The answer that one result of a generated operation states.
 *
 * A result with no data, or with an error, is refused with the status of the
 * response, and with `0` when no response came.
 */
export function settingsAnswer<D, T>(
  result: OperationResult<D>,
  settingsOf: (data: D) => T,
): SettingsAnswer<T> {
  if (result.error !== undefined || result.data === undefined)
    return {
      kind: 'refused',
      status: result.response?.status ?? 0,
      error: result.error,
    };
  return { kind: 'stored', settings: settingsOf(result.data) };
}
