/**
 * The daily notes of the open workspace (record 0099).
 *
 * One provider in the frame holds the settings of the member and the one way
 * to open the note of a date, so the Daily notes page, the command palette,
 * the sidebar and the start of the application all open a date the same way.
 * The rules live in `lib/daily-note.ts` and `@notesapp/core`; this module
 * reads the stores and the server and holds no rule of its own.
 *
 * The note of a date is the live note at its path. When there is none, the
 * device makes a local draft at that path with the text of the template, as
 * New note makes an empty one, and the save model does not change (record
 * 0022). The settings come from the server, and this device keeps the last
 * answer in browser settings, so a start with no connection still knows them.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useMatches, useNavigate } from 'react-router';
import {
  getDailyNoteSettings,
  getFile,
  updateDailyNoteSettings,
} from '@notesapp/api-client';
import {
  dailyNotePath,
  generateUUID,
  type CalendarDate,
  type DailyNoteSettings,
} from '@notesapp/core';
import { isLocalStorageError, type LocalStore } from '@notesapp/sync';
import { problemMessage, useLocalStore, useSession } from '../../app.tsx';
import { useFiles } from '../../shell/files.tsx';
import { framePageOf } from '../../lib/breadcrumb.ts';
import { dateOfInstant } from '../../lib/calendar-month.ts';
import {
  dailyNoteOf,
  dailyNoteProblems,
  dailyNoteSettingsKey,
  effectiveTemplateId,
  formatCachedSettings,
  opensTodayAtStart,
  parseCachedSettings,
  settingsProblem,
} from '../../lib/daily-note.ts';
import { newNoteDraft } from '../../lib/new-note-draft.ts';

/** Where the settings of the member stand. */
export type DailyNoteSettingsState =
  | { readonly status: 'loading' }
  /** No answer of the server and no copy on this device. */
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly settings: DailyNoteSettings };

/** What the frame and the Daily notes page read. */
export type DailyNotesValue = {
  readonly settings: DailyNoteSettingsState;
  /** Stores new settings. The visible choice moves at once. */
  readonly save: (next: DailyNoteSettings) => void;
  /** Why the last change of a setting did not reach the server. */
  readonly saveProblem: string | null;
  /** Opens the note of a date, and makes it first when there is none. */
  readonly open: (date: CalendarDate) => void;
  /** True while the note list that a lookup needs is still loading. */
  readonly waiting: boolean;
  /** Why the last open did not happen. */
  readonly openProblem: string | null;
};

const DailyNotesContext = createContext<DailyNotesValue>({
  settings: { status: 'loading' },
  save: () => {},
  saveProblem: null,
  open: () => {},
  waiting: true,
  openProblem: null,
});

/** Reads the daily notes of the open workspace. */
export function useDailyNotes(): DailyNotesValue {
  return useContext(DailyNotesContext);
}

/** The date of today on this device. */
export function today(): CalendarDate {
  return dateOfInstant(new Date());
}

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
 * The text of the template note, or `null` when this device cannot read it.
 *
 * The local store answers first, with the newest draft of this device. A note
 * this device has not received yet comes from the generated `getFile`.
 */
async function templateText(
  store: LocalStore,
  accountId: string,
  workspaceId: string,
  fileId: string,
): Promise<string | null> {
  try {
    const cached = await store.readCachedNote(accountId, workspaceId, fileId);
    if (cached !== null && !cached.deleted) return cached.text;
  } catch {
    // The server read below can still answer.
  }
  const result = await getFile({ path: { workspaceId, fileId } });
  if (result.error !== undefined || result.data === undefined) return null;
  const text = result.data.head?.text;
  return typeof text === 'string' ? text : null;
}

/** The settings of the member, read once for each workspace and kept here. */
function useSettings(
  accountId: string | null,
  workspaceId: string,
): {
  readonly settings: DailyNoteSettingsState;
  readonly save: (next: DailyNoteSettings) => void;
  readonly saveProblem: string | null;
} {
  const [settings, setSettings] = useState<DailyNoteSettingsState>({
    status: 'loading',
  });
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  // The last settings that the server confirmed, which a refused change
  // falls back to, and the chain that sends one change after another.
  const confirmed = useRef<DailyNoteSettings | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);

  useEffect(() => {
    if (accountId === null) {
      setSettings({ status: 'loading' });
      return;
    }
    generation.current += 1;
    const current = generation.current;
    const key = dailyNoteSettingsKey(accountId, workspaceId);
    const cached = parseCachedSettings(readStored(key));
    confirmed.current = cached;
    setSettings(
      cached === null
        ? { status: 'loading' }
        : { status: 'ready', settings: cached },
    );
    setSaveProblem(null);
    void getDailyNoteSettings({ path: { workspaceId } })
      .then((result) => {
        if (current !== generation.current) return;
        if (result.error !== undefined || result.data === undefined) {
          if (cached === null) setSettings({ status: 'unavailable' });
          return;
        }
        const answer: DailyNoteSettings = {
          templateFileId: result.data.templateFileId,
          openOnStart: result.data.openOnStart,
        };
        confirmed.current = answer;
        writeStored(key, formatCachedSettings(answer));
        setSettings({ status: 'ready', settings: answer });
      })
      .catch(() => {
        // No answer is a failed read and not an empty setting (record 0038).
        if (current === generation.current && cached === null)
          setSettings({ status: 'unavailable' });
      });
  }, [accountId, workspaceId]);

  const save = useCallback(
    (next: DailyNoteSettings): void => {
      if (accountId === null) return;
      const current = generation.current;
      const key = dailyNoteSettingsKey(accountId, workspaceId);
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
        const result = await updateDailyNoteSettings({
          path: { workspaceId },
          body: {
            templateFileId: next.templateFileId,
            openOnStart: next.openOnStart,
          },
        });
        if (current !== generation.current) return;
        if (result.error !== undefined || result.data === undefined) {
          refuse(
            settingsProblem(
              result.response?.status ?? 0,
              problemMessage(result.error),
            ),
          );
          return;
        }
        const answer: DailyNoteSettings = {
          templateFileId: result.data.templateFileId,
          openOnStart: result.data.openOnStart,
        };
        confirmed.current = answer;
        writeStored(key, formatCachedSettings(answer));
      });
      // A change that throws must not stop every later change, so the chain
      // never stays in a rejected state, and the person reads why.
      queue.current = queue.current.catch(() => {
        if (current === generation.current) refuse(dailyNoteProblems.offline);
      });
    },
    [accountId, workspaceId],
  );

  return { settings, save, saveProblem };
}

/** Holds the daily notes of the open workspace for every screen of the frame. */
export function DailyNotesProvider({
  workspaceId,
  children,
}: {
  readonly workspaceId: string;
  readonly children: ReactNode;
}): ReactNode {
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();
  const session = useSession();
  const { store } = useLocalStore();
  const files = useFiles();
  const accountId = session.account?.accountId ?? null;
  const { settings, save, saveProblem } = useSettings(accountId, workspaceId);
  const [openProblem, setOpenProblem] = useState<string | null>(null);
  const opening = useRef(false);

  // What a lookup and a new note read, kept current for the async open.
  const live = useRef({ store, accountId, workspaceId, settings, files });
  live.current = { store, accountId, workspaceId, settings, files };

  const openDate = useCallback(
    (date: CalendarDate, replace: boolean): void => {
      if (opening.current) return;
      const current = live.current;
      const activeStore = current.store;
      const activeAccount = current.accountId;
      if (activeStore === null || activeAccount === null) {
        setOpenProblem(dailyNoteProblems.storage);
        return;
      }
      opening.current = true;
      setOpenProblem(null);
      const workspace = current.workspaceId;
      void (async (): Promise<void> => {
        try {
          let fileId = dailyNoteOf(current.files.notes, date);
          if (fileId === null) {
            // The list of the frame is bounded, and a note of this device
            // that no list has read yet is still the note of its date.
            const local = await activeStore
              .listLocalFiles(activeAccount, workspace)
              .catch(() => []);
            fileId = dailyNoteOf(
              local.filter((file) => file.kind === 'note' && !file.deleted),
              date,
            );
          }
          if (fileId !== null) {
            await navigate(`/w/${workspace}/notes/${fileId}`, { replace });
            return;
          }
          if (current.settings.status !== 'ready') {
            setOpenProblem(dailyNoteProblems.settings);
            return;
          }
          const templateId = effectiveTemplateId(
            current.settings.settings,
            current.files.notes,
          );
          const text =
            templateId === null
              ? ''
              : await templateText(
                  activeStore,
                  activeAccount,
                  workspace,
                  templateId,
                );
          if (text === null) {
            setOpenProblem(dailyNoteProblems.template);
            return;
          }
          const draft = newNoteDraft({
            accountId: activeAccount,
            workspaceId: workspace,
            path: dailyNotePath(date),
            ids: { fileId: generateUUID(), workingCopyId: generateUUID() },
            text,
          });
          try {
            await activeStore.saveDraft(draft);
          } catch (failure: unknown) {
            setOpenProblem(
              isLocalStorageError(failure) && failure.kind === 'quota'
                ? dailyNoteProblems.quota
                : dailyNoteProblems.write,
            );
            return;
          }
          await navigate(`/w/${workspace}/notes/${draft.fileId}`, { replace });
        } finally {
          opening.current = false;
        }
      })();
    },
    [navigate],
  );

  const open = useCallback(
    (date: CalendarDate): void => {
      openDate(date, false);
    },
    [openDate],
  );

  // The note of today opens at start, once for each load of the frame, when
  // the first page was the note list and the person has not moved since.
  const start = useRef({
    key: location.key,
    onNoteList: framePageOf(matches.map((match) => match.handle)) === 'notes',
    decided: false,
  });
  const waiting = files.loading || store === null;
  useEffect(() => {
    const first = start.current;
    if (first.decided) return;
    const stillOnStart = location.key === first.key;
    if (
      first.onNoteList &&
      stillOnStart &&
      (waiting || settings.status === 'loading')
    )
      return;
    first.decided = true;
    if (
      opensTodayAtStart({
        openOnStart:
          settings.status === 'ready' && settings.settings.openOnStart,
        startedOnNoteList: first.onNoteList,
        stillOnStart,
      })
    )
      openDate(today(), true);
  }, [location.key, waiting, settings, openDate]);

  const value = useMemo<DailyNotesValue>(
    () => ({ settings, save, saveProblem, open, waiting, openProblem }),
    [settings, save, saveProblem, open, waiting, openProblem],
  );
  return (
    <DailyNotesContext.Provider value={value}>
      {children}
    </DailyNotesContext.Provider>
  );
}
