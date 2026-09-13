/**
 * Coalesces work that reads a complete Markdown document.
 *
 * The editor change callback sends the newest text here and returns. The
 * attachment scan, outline walk, and word count run after input is quiet, so
 * none of them extend the keystroke path. A later change replaces the pending
 * one because only the newest document can be useful to those readers.
 */

/** One deferred document-work queue. */
export type DocumentWorkQueue = {
  /** Replaces the pending text and schedules one run. */
  readonly schedule: (text: string) => void;
  /** Cancels work that has not started. */
  readonly cancel: () => void;
};

/** Dependencies that make the queue deterministic in a unit test. */
export type DocumentWorkOptions<Token> = {
  readonly delayMs: number;
  readonly defer: (run: () => void, delayMs: number) => Token;
  readonly cancel: (token: Token) => void;
  readonly run: (text: string) => void;
};

/** Creates one latest-value queue for document-wide derived work. */
export function createDocumentWorkQueue<Token>(
  options: DocumentWorkOptions<Token>,
): DocumentWorkQueue {
  let pending: Token | null = null;
  let latest = '';

  const cancel = (): void => {
    if (pending === null) return;
    options.cancel(pending);
    pending = null;
  };

  return {
    schedule(text: string): void {
      latest = text;
      cancel();
      pending = options.defer(() => {
        pending = null;
        options.run(latest);
      }, options.delayMs);
    },
    cancel,
  };
}
