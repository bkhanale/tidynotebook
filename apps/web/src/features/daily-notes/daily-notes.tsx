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
 * device makes the note at that path with the text of the template, as New
 * note makes an empty one, and its create waits in the queue at once (record
 * 0104). The settings come from the server, and this device keeps the last
 * answer in browser settings through the one hook of member settings, so a
 * start with no connection still knows them. The template fills through the
 * one engine of `@notesapp/core` (record 0149).
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
  updateDailyNoteSettings,
} from '@notesapp/api-client';
import {
  dailyNotePath,
  fillTemplate,
  generateUUID,
  type CalendarDate,
  type DailyNoteSettings,
} from '@notesapp/core';
import { createNote, isLocalStorageError } from '@notesapp/sync';
import { problemMessage, useLocalStore, useSession } from '../../app.tsx';
import { useFiles } from '../../shell/files.tsx';
import { useMemberSettings } from '../../shell/member-settings.ts';
import { readNoteText } from '../../shell/note-text.ts';
import { framePageOf } from '../../lib/breadcrumb.ts';
import { dateOfInstant } from '../../lib/calendar-month.ts';
import {
  dailyNoteOf,
  dailyNoteProblems,
  dailyNoteSettingsName,
  effectiveTemplateId,
  formatCachedSettings,
  opensTodayAtStart,
  parseCachedSettings,
  settingsProblem,
} from '../../lib/daily-note.ts';
import {
  settingsAnswer,
  type MemberSettingsSource,
  type MemberSettingsState,
} from '../../lib/member-settings.ts';
import { newNoteDraft } from '../../lib/new-note-draft.ts';
import { baseNameOf, displayNoteName } from '../../lib/note-name.ts';
import { templateContextAt } from '../../lib/templates.ts';

/** Where the settings of the member stand. */
export type DailyNoteSettingsState = MemberSettingsState<DailyNoteSettings>;

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

/** The settings that one answer of the server states. */
function settingsOfAnswer(answer: DailyNoteSettings): DailyNoteSettings {
  return {
    templateFileId: answer.templateFileId,
    openOnStart: answer.openOnStart,
    folder: answer.folder,
    format: answer.format,
  };
}

/** How the daily note settings read, write and cache themselves. */
const dailyNoteSettingsSource: MemberSettingsSource<DailyNoteSettings> = {
  name: dailyNoteSettingsName,
  read: async (workspaceId) =>
    settingsAnswer(
      await getDailyNoteSettings({ path: { workspaceId } }),
      settingsOfAnswer,
    ),
  write: async (workspaceId, settings) =>
    settingsAnswer(
      await updateDailyNoteSettings({
        path: { workspaceId },
        body: settingsOfAnswer(settings),
      }),
      settingsOfAnswer,
    ),
  encode: formatCachedSettings,
  decode: parseCachedSettings,
  refusal: (status, error) => settingsProblem(status, problemMessage(error)),
};

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
  const { settings, save, saveProblem } = useMemberSettings(
    dailyNoteSettingsSource,
    accountId,
    workspaceId,
  );
  const [openProblem, setOpenProblem] = useState<string | null>(null);
  const opening = useRef(false);
  // An open that came while the settings were loading, which runs as soon as
  // they arrive.
  const pendingOpen = useRef<{
    readonly date: CalendarDate;
    readonly replace: boolean;
  } | null>(null);

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
      // The path of a date comes from the layout of the member (record
      // 0101), so an open waits for the settings, and it cannot happen
      // without them.
      if (current.settings.status === 'loading') {
        pendingOpen.current = { date, replace };
        return;
      }
      if (current.settings.status === 'unavailable') {
        setOpenProblem(dailyNoteProblems.settings);
        return;
      }
      const settings = current.settings.settings;
      opening.current = true;
      setOpenProblem(null);
      const workspace = current.workspaceId;
      void (async (): Promise<void> => {
        try {
          let fileId = dailyNoteOf(current.files.notes, date, settings);
          if (fileId === null) {
            // The list of the frame is bounded, and a note of this device
            // that no list has read yet is still the note of its date.
            const local = await activeStore
              .listLocalFiles(activeAccount, workspace)
              .catch(() => []);
            fileId = dailyNoteOf(
              local.filter((file) => file.kind === 'note' && !file.deleted),
              date,
              settings,
            );
          }
          if (fileId !== null) {
            await navigate(`/w/${workspace}/notes/${fileId}`, { replace });
            return;
          }
          const templateId = effectiveTemplateId(settings, current.files.notes);
          const text =
            templateId === null
              ? ''
              : await readNoteText(
                  activeStore,
                  activeAccount,
                  workspace,
                  templateId,
                );
          if (text === null) {
            setOpenProblem(dailyNoteProblems.template);
            return;
          }
          // The placeholders of the template take the date and the name of
          // this note and the time of now, once, and the note stores the
          // result (records 0102 and 0149).
          const path = dailyNotePath(date, settings);
          const draft = newNoteDraft({
            accountId: activeAccount,
            workspaceId: workspace,
            path,
            ids: { fileId: generateUUID(), workingCopyId: generateUUID() },
            text: fillTemplate(
              text,
              templateContextAt(
                new Date(),
                displayNoteName(baseNameOf(path)),
                date,
              ),
            ),
          });
          try {
            await createNote(activeStore, draft);
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

  useEffect(() => {
    if (settings.status === 'loading') return;
    const pending = pendingOpen.current;
    pendingOpen.current = null;
    if (pending !== null) openDate(pending.date, pending.replace);
  }, [settings.status, openDate]);

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
