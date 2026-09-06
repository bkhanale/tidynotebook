/**
 * Observability, structured logging, and Prometheus metrics.
 *
 * All logs are content-free: note bodies, search queries, passwords, tokens,
 * cookies, and public share URLs are excluded or redacted.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Content-free request log entry. */
export type RequestLogRecord = {
  readonly requestId: string;
  readonly method: string;
  readonly url: string;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly errorCode?: string;
};

/** Redacts sensitive path segments and query strings from a URL. */
export function redactUrl(rawUrl: string): string {
  const [pathPart] = rawUrl.split('?');
  const path = (pathPart ?? rawUrl).replace(
    /^(\/s\/)[^/?]+(?:\/attachments\/[^/?]+)?/,
    '$1[redacted]',
  );
  // Redact any query string completely to ensure search terms and parameters never leak.
  if (rawUrl.includes('?')) {
    return `${path}?[redacted]`;
  }
  return path;
}

/** Metrics collector for system health and operations. */
export class MetricsCollector {
  private saveFailures = 0;
  private conflicts = 0;
  private authFailures = 0;
  private readonly httpRequests = new Map<string, number>();

  private readonly storageRoot: string;
  private readonly getStorageUsage: (() => Promise<number>) | undefined;

  constructor(storageRoot: string, getStorageUsage?: () => Promise<number>) {
    this.storageRoot = storageRoot;
    this.getStorageUsage = getStorageUsage;
  }

  recordSaveFailure(): void {
    this.saveFailures += 1;
  }

  recordConflict(): void {
    this.conflicts += 1;
  }

  recordAuthFailure(): void {
    this.authFailures += 1;
  }

  recordHttpRequest(method: string, status: number): void {
    const key = `${method.toUpperCase()}_${status}`;
    const current = this.httpRequests.get(key) ?? 0;
    this.httpRequests.set(key, current + 1);
  }

  getSaveFailures(): number {
    return this.saveFailures;
  }

  getConflicts(): number {
    return this.conflicts;
  }

  getAuthFailures(): number {
    return this.authFailures;
  }

  /**
   * Calculates the age in seconds of the most recent backup.
   *
   * Reads from the backup marker file written by the backup operator script.
   * Returns -1 if no backup record exists yet.
   */
  async getBackupAgeSeconds(now = new Date()): Promise<number> {
    const markerPath = join(this.storageRoot, 'backup-last.json');
    if (!existsSync(markerPath)) {
      return -1;
    }
    try {
      const raw = await readFile(markerPath, 'utf8');
      const data = JSON.parse(raw) as { timestamp?: string };
      if (!data.timestamp) {
        return -1;
      }
      const backupTime = new Date(data.timestamp).getTime();
      if (Number.isNaN(backupTime)) {
        return -1;
      }
      return Math.max(0, Math.floor((now.getTime() - backupTime) / 1000));
    } catch {
      return -1;
    }
  }

  /** Retrieves the current storage usage in bytes. */
  async getStorageUsageBytes(): Promise<number> {
    if (this.getStorageUsage) {
      try {
        return await this.getStorageUsage();
      } catch {
        return 0;
      }
    }
    const sizeOf = async (path: string): Promise<number> => {
      let entries;
      try {
        entries = await readdir(path, { withFileTypes: true });
      } catch {
        return 0;
      }
      let total = 0;
      for (const entry of entries) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) total += await sizeOf(child);
        else if (entry.isFile()) total += (await stat(child)).size;
      }
      return total;
    };
    return sizeOf(join(this.storageRoot, 'workspaces'));
  }

  /** Serializes current metrics to Prometheus text exposition format. */
  async toPrometheusFormat(): Promise<string> {
    const storageUsage = await this.getStorageUsageBytes();
    const backupAge = await this.getBackupAgeSeconds();

    const lines: string[] = [
      '# HELP notesapp_save_failures_total Total count of save failures',
      '# TYPE notesapp_save_failures_total counter',
      `notesapp_save_failures_total ${this.saveFailures}`,
      '',
      '# HELP notesapp_conflicts_total Total count of revision conflicts',
      '# TYPE notesapp_conflicts_total counter',
      `notesapp_conflicts_total ${this.conflicts}`,
      '',
      '# HELP notesapp_auth_failures_total Total count of authentication failures',
      '# TYPE notesapp_auth_failures_total counter',
      `notesapp_auth_failures_total ${this.authFailures}`,
      '',
      '# HELP notesapp_storage_usage_bytes Current storage usage in bytes',
      '# TYPE notesapp_storage_usage_bytes gauge',
      `notesapp_storage_usage_bytes ${storageUsage}`,
      '',
      '# HELP notesapp_backup_age_seconds Age of most recent backup in seconds',
      '# TYPE notesapp_backup_age_seconds gauge',
      `notesapp_backup_age_seconds ${backupAge}`,
    ];

    for (const [key, count] of this.httpRequests.entries()) {
      const [method, status] = key.split('_');
      lines.push(
        `notesapp_http_requests_total{method="${method}",status="${status}"} ${count}`,
      );
    }

    lines.push('');
    return lines.join('\n');
  }

  /** Serializes current metrics to JSON. */
  async toJson(): Promise<Record<string, unknown>> {
    return {
      saveFailures: this.saveFailures,
      conflicts: this.conflicts,
      authFailures: this.authFailures,
      storageUsageBytes: await this.getStorageUsageBytes(),
      backupAgeSeconds: await this.getBackupAgeSeconds(),
    };
  }
}

/** Attaches request logging hooks and observability metrics to the Fastify application. */
export function attachObservability(
  app: FastifyInstance,
  collector: MetricsCollector,
): void {
  app.addHook(
    'onRequest',
    async (request: FastifyRequest & { startTime?: bigint }) => {
      request.startTime = process.hrtime.bigint();
    },
  );

  app.addHook(
    'onResponse',
    async (
      request: FastifyRequest & { startTime?: bigint },
      reply: FastifyReply,
    ) => {
      const durationMs = request.startTime
        ? Number(process.hrtime.bigint() - request.startTime) / 1_000_000
        : 0;

      const method = request.method;
      const statusCode = reply.statusCode;
      collector.recordHttpRequest(method, statusCode);

      // Classify operational metrics
      if (statusCode === 409 || statusCode === 412) {
        collector.recordConflict();
      }
      if (
        (statusCode === 401 || statusCode === 403) &&
        request.url.startsWith('/api/auth')
      ) {
        collector.recordAuthFailure();
      }
      if (
        statusCode >= 400 &&
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      ) {
        collector.recordSaveFailure();
      }

      if (app.log && typeof app.log.info === 'function') {
        app.log.info({
          type: 'request',
          requestId: request.id,
          method,
          url: redactUrl(request.url),
          statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        });
      }
    },
  );
}
