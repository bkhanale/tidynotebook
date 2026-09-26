/** Whether the note list header holds the New note action. */
export function showNewNoteInHeader(loading: boolean, total: number): boolean {
  return loading || total > 0;
}
