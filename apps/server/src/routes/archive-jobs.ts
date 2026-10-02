/**
 * The bounds of the import and export jobs that run at once (record 0170).
 *
 * An import keeps an archive of up to 4 GiB on the storage volume, and an
 * export reads every live file of a workspace, so the number of such jobs
 * bounds the disk and the database work of the server. Each job holds one
 * reservation of `archive_jobs` in PostgreSQL while it runs, so the bound
 * holds across every process of the installation (record 0121). A job renews
 * its reservation while it runs, and a process that stops leaves a
 * reservation that expires.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { CoordinationHandle } from '@notesapp/storage-server';
import { ArchiveJobRefusedError } from '../plugins/problem.ts';

/** How many archive jobs one account runs at once. */
export const archiveJobsPerAccount = 1;

/** How many archive jobs the installation runs at once. */
export const archiveJobsPerInstallation = 2;

/** The seconds after which a refused person may try again. */
export const archiveJobRetryAfterSeconds = 30;

/** How long one reservation lives without a renewal. */
const reservationTtlMs = 60_000;

/** How often a running job renews its reservation. */
const renewalMs = 20_000;

/** One running job. Its release is safe to call more than once. */
export type ArchiveJobLease = {
  readonly release: () => Promise<void>;
};

/** Reserves the job of one account, or refuses it. */
export type ArchiveJobs = {
  readonly reserve: (accountId: string) => Promise<ArchiveJobLease>;
};

/** The archive jobs of one installation, held in PostgreSQL. */
export function coordinatedArchiveJobs(
  coordination: Pick<
    CoordinationHandle,
    'reserveArchiveJob' | 'renewArchiveJob' | 'releaseArchiveJob'
  >,
): ArchiveJobs {
  return {
    reserve: async (accountId) => {
      const id = randomUUID();
      const state = await coordination.reserveArchiveJob(
        id,
        accountId,
        reservationTtlMs,
        {
          account: archiveJobsPerAccount,
          installation: archiveJobsPerInstallation,
        },
      );
      if (state === 'account')
        throw new ArchiveJobRefusedError(
          'archive_job_running',
          'An import or an export of this account runs now. Wait until it ends, then try again.',
        );
      if (state === 'installation')
        throw new ArchiveJobRefusedError(
          'archive_jobs_busy',
          'The server runs as many imports and exports as it can now. Try again in a minute.',
        );
      const renewal = setInterval(() => {
        void coordination.renewArchiveJob(id, reservationTtlMs).catch(() => {
          // A renewal that fails lets the reservation expire, which frees it.
        });
      }, renewalMs);
      renewal.unref();
      let released = false;
      return {
        release: async () => {
          if (released) return;
          released = true;
          clearInterval(renewal);
          await coordination.releaseArchiveJob(id);
        },
      };
    },
  };
}

/**
 * Reserves the job of one account for one answer, and writes `Retry-After`
 * on the answer when the job is refused.
 */
export async function reserveArchiveJob(
  jobs: ArchiveJobs,
  reply: FastifyReply,
  accountId: string,
): Promise<ArchiveJobLease> {
  try {
    return await jobs.reserve(accountId);
  } catch (error) {
    if (error instanceof ArchiveJobRefusedError)
      reply.header('retry-after', String(archiveJobRetryAfterSeconds));
    throw error;
  }
}
