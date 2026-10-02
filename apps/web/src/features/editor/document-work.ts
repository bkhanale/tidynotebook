/**
 * Coalesces work that reads a complete Markdown document.
 *
 * The editor change callback sends the newest value here and returns: the
 * reader of the text, so a key copies no text (record 0175). The attachment
 * scan, outline walk, and word count run after input is quiet, so none of
 * them extend the keystroke path. A later change replaces the pending one
 * because only the newest document can be useful to those readers.
 */

/** One deferred document-work queue. */
export type DocumentWorkQueue<Value> = {
  /** Replaces the pending value and schedules one run. */
  readonly schedule: (value: Value) => void;
  /** Cancels work that has not started. */
  readonly cancel: () => void;
};

/** Dependencies that make the queue deterministic in a unit test. */
export type DocumentWorkOptions<Token, Value> = {
  readonly delayMs: number;
  readonly defer: (run: () => void, delayMs: number) => Token;
  readonly cancel: (token: Token) => void;
  readonly run: (value: Value) => void;
};

/** Creates one latest-value queue for document-wide derived work. */
export function createDocumentWorkQueue<Token, Value = string>(
  options: DocumentWorkOptions<Token, Value>,
): DocumentWorkQueue<Value> {
  let pending: Token | null = null;
  let latest: Value | null = null;

  const cancel = (): void => {
    if (pending === null) return;
    options.cancel(pending);
    pending = null;
  };

  return {
    schedule(value: Value): void {
      latest = value;
      cancel();
      pending = options.defer(() => {
        pending = null;
        const taken = latest;
        latest = null;
        if (taken !== null) options.run(taken);
      }, options.delayMs);
    },
    cancel,
  };
}
