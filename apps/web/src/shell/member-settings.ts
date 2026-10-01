/**
 * The one hook that holds a setting of the member in the open workspace
 * (records 0099 and 0149).
 *
 * The server is the source of a member setting, and this device keeps the
 * last answer in browser settings, so a start with no connection still knows
 * it. A change shows at once, goes to the server one after another in the
 * order the person made them, and falls back to the last confirmed answer
 * with one sentence when the server refuses it. The daily note settings and
 * the template settings each give one `MemberSettingsSource`, and this hook
 * holds every other part, so the two cannot drift apart.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  memberSettingsKey,
  type MemberSettingsSource,
  type MemberSettingsState,
} from '../lib/member-settings.ts';

/** What a provider of a member setting reads from this hook. */
export type MemberSettings<T> = {
  readonly settings: MemberSettingsState<T>;
  /** Stores new settings. The visible choice moves at once. */
  readonly save: (next: T) => void;
  /** Why the last change of a setting did not reach the server. */
  readonly saveProblem: string | null;
};

/** Reads one browser setting, or `null` when storage refuses. */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Writes one browser setting. The copy is a cache, so a refusal is quiet. */
function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The server keeps the settings, so the next start asks it again.
  }
}

/**
 * The settings of the member, read once for each workspace and kept here.
 *
 * `source` must be one stable value, such as a constant of a module, because
 * a new source reads the settings again.
 */
export function useMemberSettings<T>(
  source: MemberSettingsSource<T>,
  accountId: string | null,
  workspaceId: string,
): MemberSettings<T> {
  const [settings, setSettings] = useState<MemberSettingsState<T>>({
    status: 'loading',
  });
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  // The last settings that the server confirmed, which a refused change
  // falls back to, and the chain that sends one change after another.
  const confirmed = useRef<T | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);

  useEffect(() => {
    if (accountId === null) {
      setSettings({ status: 'loading' });
      return;
    }
    generation.current += 1;
    const current = generation.current;
    const key = memberSettingsKey(source.name, accountId, workspaceId);
    const cached = source.decode(readStored(key));
    confirmed.current = cached;
    setSettings(
      cached === null
        ? { status: 'loading' }
        : { status: 'ready', settings: cached },
    );
    setSaveProblem(null);
    void source
      .read(workspaceId)
      .then((answer) => {
        if (current !== generation.current) return;
        if (answer.kind === 'refused') {
          if (cached === null) setSettings({ status: 'unavailable' });
          return;
        }
        confirmed.current = answer.settings;
        writeStored(key, source.encode(answer.settings));
        setSettings({ status: 'ready', settings: answer.settings });
      })
      .catch(() => {
        // No answer is a failed read and not an empty setting (record 0038).
        if (current === generation.current && cached === null)
          setSettings({ status: 'unavailable' });
      });
  }, [source, accountId, workspaceId]);

  const save = useCallback(
    (next: T): void => {
      if (accountId === null) return;
      const current = generation.current;
      const key = memberSettingsKey(source.name, accountId, workspaceId);
      /** States why, and shows the choice the server last confirmed. */
      const refuse = (problem: string): void => {
        setSaveProblem(problem);
        const fallback = confirmed.current;
        setSettings(
          fallback === null
            ? { status: 'unavailable' }
            : { status: 'ready', settings: fallback },
        );
      };
      setSettings({ status: 'ready', settings: next });
      setSaveProblem(null);
      // One change at a time, in the order the person made them, so the
      // server ends on the last choice and never on an earlier one.
      queue.current = queue.current.then(async () => {
        const answer = await source.write(workspaceId, next);
        if (current !== generation.current) return;
        if (answer.kind === 'refused') {
          refuse(source.refusal(answer.status, answer.error));
          return;
        }
        confirmed.current = answer.settings;
        writeStored(key, source.encode(answer.settings));
      });
      // A change that throws must not stop every later change, so the chain
      // never stays in a rejected state, and the person reads why.
      queue.current = queue.current.catch(() => {
        if (current === generation.current) refuse(source.unsent);
      });
    },
    [source, accountId, workspaceId],
  );

  return { settings, save, saveProblem };
}
