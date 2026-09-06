/**
 * Persistent write-pause coordinator.
 *
 * Maintenance and backup operations pause mutations across HTTP routes and
 * background jobs. The state persists on disk so restarts during maintenance
 * stay paused until explicitly resumed.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** State stored in the persistent write-pause file. */
export type WritePauseState = {
  readonly paused: boolean;
  readonly pausedAt?: string;
  readonly reason?: string;
  readonly activeWriters?: number;
  readonly drained?: boolean;
  readonly drainedAt?: string;
  readonly resumedAt?: string;
};

/** Coordinates persistent write pause and active write tracking. */
export class WritePauseCoordinator {
  private activeWriters = 0;
  private paused = false;
  private drainResolvers: Array<() => void> = [];
  private readonly filePath: string;
  private readonly writerDirectory: string;

  private readonly storageRoot: string;

  constructor(storageRoot: string) {
    this.storageRoot = storageRoot;
    this.filePath = join(this.storageRoot, 'write-pause.json');
    this.writerDirectory = join(this.storageRoot, 'active-writes');
    this.initFromDisk();
  }

  /** Reads the persistent file if present on startup. */
  private initFromDisk(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as WritePauseState;
        if (parsed.paused === true) {
          this.paused = true;
        }
      }
    } catch {
      // If the file is unreadable, fail closed.
      this.paused = true;
    }
    mkdirSync(this.writerDirectory, { recursive: true });
  }

  /** Path to the persistent write-pause file. */
  get path(): string {
    return this.filePath;
  }

  /** Returns true when write operations are paused. */
  isPaused(): boolean {
    if (!this.paused && existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as WritePauseState;
        if (parsed.paused === true) {
          this.paused = true;
        }
      } catch {
        this.paused = true;
      }
    }
    return this.paused;
  }

  /** Number of active writes currently running. */
  getActiveWriters(): number {
    return this.activeWriters;
  }

  /**
   * Begins a tracked write operation.
   *
   * Returns a release callback if writes are allowed.
   * Returns null if write operations are currently paused.
   */
  beginWrite(): (() => void) | null {
    if (this.isPaused()) {
      return null;
    }

    const markerPath = join(this.writerDirectory, `${randomUUID()}.active`);
    try {
      writeFileSync(
        markerPath,
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        }),
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
    } catch {
      // An operator cannot prove a safe backup drain without this marker.
      // Refuse the write if its durable active state cannot be recorded.
      return null;
    }

    // The backup process can create the pause file between the first check and
    // marker creation. Recheck after the marker exists. A backup either sees
    // the marker and waits, or this path removes it before any mutation runs.
    if (this.isPaused()) {
      unlinkSync(markerPath);
      return null;
    }

    this.activeWriters += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      try {
        unlinkSync(markerPath);
      } catch {
        // Keep the in-memory counter correct. A stale marker makes the next
        // backup fail closed until the application restarts or an operator
        // inspects it.
      }
      this.activeWriters = Math.max(0, this.activeWriters - 1);
      if (this.activeWriters === 0) {
        const listeners = [...this.drainResolvers];
        this.drainResolvers = [];
        for (const resolve of listeners) {
          resolve();
        }
      }
    };
  }

  /** Waits until all active writers have finished. */
  async drain(timeoutMs = 30000): Promise<void> {
    if (this.activeWriters === 0) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.drainResolvers.indexOf(onDrain);
        if (index >= 0) {
          this.drainResolvers.splice(index, 1);
        }
        reject(
          new Error(
            `Timed out after ${timeoutMs}ms waiting for active writers to drain (${this.activeWriters} remaining).`,
          ),
        );
      }, timeoutMs);

      const onDrain = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.drainResolvers.push(onDrain);
    });
  }

  /**
   * Pauses all write mutations and drains in-flight writes.
   *
   * Writes the persistent pause state before draining active writers.
   */
  async pause(
    reason = 'Operator maintenance',
    timeoutMs = 30000,
  ): Promise<void> {
    this.paused = true;
    const pausedAt = new Date().toISOString();
    await this.persistState({
      paused: true,
      pausedAt,
      reason,
      drained: false,
      activeWriters: this.activeWriters,
    });
    await this.drain(timeoutMs);
    await this.persistState({
      paused: true,
      pausedAt,
      reason,
      drained: true,
      drainedAt: new Date().toISOString(),
      activeWriters: 0,
    });
  }

  /** Resumes write mutations and clears the pause file. */
  async resume(): Promise<void> {
    await this.persistState({
      paused: false,
      resumedAt: new Date().toISOString(),
      activeWriters: this.activeWriters,
    });
    await rm(this.filePath, { force: true });
    this.paused = false;
  }

  /** Current coordinator status. */
  status(): WritePauseState {
    return {
      paused: this.isPaused(),
      activeWriters: this.activeWriters,
      drained: this.paused && this.activeWriters === 0,
    };
  }

  /** Atomically writes the pause state to disk. */
  private async persistState(state: WritePauseState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    await rename(tempPath, this.filePath);
  }
}
