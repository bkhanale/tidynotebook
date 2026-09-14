/** Pino sink adapter for the shared structured logger. */
import type { FastifyBaseLogger } from 'fastify';
import {
  createLogger,
  type Logger,
  type LogRecord,
  type LogSink,
} from '@notesapp/logging';

/** Reads the fixed level from one complete shared record. */
function recordLevel(record: LogRecord): 'debug' | 'info' | 'warn' | 'error' {
  const level = record['level'];
  if (level === 'debug' || level === 'info' || level === 'warn') return level;
  return 'error';
}

/** Builds the only sink that writes application records through Pino. */
export function createServerLogger(transport: FastifyBaseLogger): Logger {
  const sink: LogSink = {
    write(record): void {
      const payload = Object.fromEntries(
        Object.entries(record).filter(([name]) => name !== 'level'),
      );
      const level = recordLevel(record);
      if (level === 'error') transport.error(payload);
      else if (level === 'warn') transport.warn(payload);
      else if (level === 'info') transport.info(payload);
      else transport.debug(payload);
    },
  };
  return createLogger(sink);
}

/** A content-free name for an unknown failure. */
export function errorName(error: unknown): string {
  return error instanceof Error && error.name !== ''
    ? error.name
    : 'UnknownError';
}
