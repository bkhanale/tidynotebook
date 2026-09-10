/** The storage suffix that is hidden from note names in the interface. */
const markdownSuffix = '.md';

/** Converts a stored Markdown path to the name that a person edits. */
export function displayNoteName(path: string): string {
  return path.toLowerCase().endsWith(markdownSuffix)
    ? path.slice(0, -markdownSuffix.length)
    : path;
}

/** Converts an edited note name to its canonical Markdown storage path. */
export function storageNotePath(name: string): string {
  return `${displayNoteName(name)}${markdownSuffix}`;
}
