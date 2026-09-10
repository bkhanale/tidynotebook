/**
 * The actions the open note screen offers to the rest of the shell.
 *
 * The command palette lives in the shell and the note screen lives under
 * it, so the note screen registers what it can do and the palette offers
 * only those actions. This replaces the window event bus that connected
 * the old header search to the editor: the channel is typed, it is scoped
 * to the React tree, and an action that no screen registered is not
 * offered at all.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** What the open note screen can do on request. */
export type NoteScreenActions = {
  readonly fileId: string;
  /** Switches between Write and Read, when the screen offers both. */
  readonly toggleReadMode: (() => void) | null;
};

type NoteActionsChannel = {
  readonly actions: NoteScreenActions | null;
  readonly register: (actions: NoteScreenActions | null) => void;
};

const NoteActionsContext = createContext<NoteActionsChannel>({
  actions: null,
  register: () => {},
});

/** Holds what the open note screen registered. */
export function NoteActionsScope({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const [actions, setActions] = useState<NoteScreenActions | null>(null);
  const value = useMemo<NoteActionsChannel>(
    () => ({ actions, register: setActions }),
    [actions],
  );
  return (
    <NoteActionsContext.Provider value={value}>
      {children}
    </NoteActionsContext.Provider>
  );
}

/** Reads what the open note screen can do, or `null` on another screen. */
export function useNoteActions(): NoteScreenActions | null {
  return useContext(NoteActionsContext).actions;
}

/** Registers the actions of the open note screen while it is mounted. */
export function useRegisterNoteActions(actions: NoteScreenActions): void {
  const { register } = useContext(NoteActionsContext);
  const { fileId, toggleReadMode } = actions;
  useEffect(() => {
    register({ fileId, toggleReadMode });
    return () => {
      register(null);
    };
  }, [register, fileId, toggleReadMode]);
}
