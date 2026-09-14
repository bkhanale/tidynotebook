/** Browser console sink adapter for the shared structured logger. */
import { createLogger, type LogRecord, type LogSink } from '@notesapp/logging';

const browserSink: LogSink = {
  write(record: LogRecord): void {
    if (import.meta.env.PROD !== true) return;
    const level = record['level'];
    if (level === 'error') console.error(record);
    else if (level === 'warn') console.warn(record);
  },
};

/** The one logger used by browser application code. */
export const webLogger = createLogger(browserSink);
