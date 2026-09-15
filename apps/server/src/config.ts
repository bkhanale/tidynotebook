/**
 * Server configuration.
 *
 * Configuration is read once from the environment and validated against a JSON
 * Schema 2020-12 document with Ajv. Loading fails closed: an absent value, an
 * empty value, or a value outside its stated range stops startup instead of
 * falling back to a default that a deployment did not choose.
 */
import type { SchemaObject } from '@notesapp/api-contract';
import { compileSchema, describeIssues } from '@notesapp/api-contract';
import { readFile } from 'node:fs/promises';
import { readServedOrigins } from './served-origins.ts';

const logLevels = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'silent',
] as const;

/** Accepted structured log levels. */
export type LogLevel = (typeof logLevels)[number];

function isLogLevel(value: string): value is LogLevel {
  return logLevels.some((level) => level === value);
}

/** The mail transport that password recovery uses, when one is configured. */
export type MailConfig = {
  /** SMTP URL of the transport, for example `smtps://user:secret@host:465`. */
  readonly smtpUrl: string;
  /** Address that a recovery message is sent from. */
  readonly from: string;
};

/** Validated server configuration. */
export type ServerConfig = {
  /**
   * Canonical origin of this deployment.
   *
   * It is the first entry of `servedOrigins`. It decides the base URL of the
   * identity routes, the secure cookie flag, and the default listening port.
   */
  readonly origin: string;
  /** PostgreSQL connection URL of the runtime role. */
  readonly databaseUrl: string;
  /**
   * PostgreSQL connection URL of the identity role.
   *
   * Only the Better Auth pool uses it. That role holds every right on the four
   * Better Auth tables and no right anywhere else, and the runtime role holds
   * no right on those four tables, so the application cannot read a session
   * token, a password hash, or a reset token through any query.
   */
  readonly authDatabaseUrl: string;
  /** Directory that holds immutable attachment content. */
  readonly storageRoot: string;
  /** Secret that signs sessions and tokens. */
  readonly authSecret: string;
  /**
   * Every origin that this deployment serves, the canonical one first.
   *
   * It is the one list. The cookie write check, the trusted list of the
   * identity routes, and the Host allowlist all read it. See
   * [decision 0039](../../../docs/decisions/0039-one-list-of-served-origins.md).
   */
  readonly servedOrigins: readonly string[];
  /** Level of the structured log. `silent` disables logging. */
  readonly logLevel: LogLevel;
  /** Request limits applied before a handler runs. */
  readonly limits: {
    readonly bodyBytes: number;
    readonly headerBytes: number;
    readonly requestTimeoutMs: number;
  };
  /** Attempt limit for the public setup and authentication routes. */
  readonly rateLimit: {
    readonly windowSeconds: number;
    readonly max: number;
  };
  /**
   * Mail transport of local password recovery, or `null`.
   *
   * When it is `null`, recovery by email is disabled and the documented path
   * is the operator command `pnpm account:recover`.
   */
  readonly mail: MailConfig | null;
  /** Life of one browser session, in seconds. */
  readonly sessionMaxAgeSeconds: number;
  /**
   * The stop of this process.
   *
   * `gracePeriodMs` is the wait between the moment the readiness answer
   * reports the stop and the moment the listener closes. A proxy reads that
   * answer inside the window and sends the next request elsewhere. A
   * deployment with no proxy in front sets it to zero.
   *
   * `deadlineMs` is the whole budget from the stop signal to a forced exit, so
   * one request that never completes cannot hold the process. It must be
   * longer than the grace period. The stop of the container platform must
   * allow at least this much time.
   */
  readonly shutdown: {
    readonly gracePeriodMs: number;
    readonly deadlineMs: number;
  };
};

/** Startup failure that names every rejected configuration entry. */
export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Server configuration is not usable:\n${issues.join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const variables = [
  'NOTESAPP_ORIGIN',
  'NOTESAPP_DATABASE_URL',
  'NOTESAPP_AUTH_DATABASE_URL',
  'NOTESAPP_STORAGE_ROOT',
  'NOTESAPP_AUTH_SECRET',
  'NOTESAPP_LOG_LEVEL',
  'NOTESAPP_MAX_BODY_BYTES',
  'NOTESAPP_MAX_HEADER_BYTES',
  'NOTESAPP_REQUEST_TIMEOUT_MS',
] as const;

/**
 * Values that a deployment may leave unset.
 *
 * An absent value has a stated meaning: no additional origin serves the
 * canonical origin and nothing else, and no mail transport disables recovery
 * by email. An empty value is treated as absent, so a placeholder in a Compose
 * file cannot enable a half configured transport.
 */
const optionalVariables = [
  'NOTESAPP_ADDITIONAL_ORIGINS',
  'NOTESAPP_SMTP_URL',
  'NOTESAPP_MAIL_FROM',
  'NOTESAPP_SESSION_MAX_AGE_S',
  'NOTESAPP_RATE_LIMIT_WINDOW_S',
  'NOTESAPP_RATE_LIMIT_MAX',
  'NOTESAPP_SHUTDOWN_GRACE_MS',
  'NOTESAPP_SHUTDOWN_DEADLINE_MS',
] as const;

const protectedFiles = {
  NOTESAPP_DATABASE_URL: 'NOTESAPP_DATABASE_URL_FILE',
  NOTESAPP_AUTH_DATABASE_URL: 'NOTESAPP_AUTH_DATABASE_URL_FILE',
  NOTESAPP_AUTH_SECRET: 'NOTESAPP_AUTH_SECRET_FILE',
  NOTESAPP_SMTP_URL: 'NOTESAPP_SMTP_URL_FILE',
} as const;

type RawConfig = Record<(typeof variables)[number], string> &
  Partial<Record<(typeof optionalVariables)[number], string>>;

/** Loads protected configuration values from explicit files. */
export async function loadProtectedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<Record<string, string | undefined>> {
  const loaded: Record<string, string | undefined> = { ...environment };
  for (const [valueName, fileName] of Object.entries(protectedFiles)) {
    const direct = environment[valueName];
    const path = environment[fileName];
    if (
      direct !== undefined &&
      direct !== '' &&
      path !== undefined &&
      path !== ''
    )
      throw new ConfigError([
        `${valueName}: set either ${valueName} or ${fileName}, not both.`,
      ]);
    if (path === undefined || path === '') continue;
    let value: string;
    try {
      value = (await readFile(path, 'utf8')).trim();
    } catch {
      throw new ConfigError([
        `${fileName}: the protected file cannot be read.`,
      ]);
    }
    if (value === '')
      throw new ConfigError([`${fileName}: the protected file is empty.`]);
    loaded[valueName] = value;
  }
  return loaded;
}

const positiveInteger = { type: 'string', pattern: '^[1-9][0-9]{0,9}$' };
// A grace period of zero is a stated choice: the deployment has no proxy in
// front, so nothing has to observe the readiness answer before the listener
// closes.
const wholeNumber = { type: 'string', pattern: '^(0|[1-9][0-9]{0,9})$' };

/**
 * The stop of a deployment that names no value of its own.
 *
 * Five seconds covers the readiness interval of a common reverse proxy, so the
 * proxy reads the stop before the listener closes. Twenty seconds is longer
 * than the request timeout of this server, so a request that obeys that
 * timeout always completes inside the budget. Both values stay well inside the
 * stop period that `docker-compose.yml` gives the container.
 */
const defaultShutdownGraceMs = 5000;
const defaultShutdownDeadlineMs = 20000;

/**
 * Values that this release does not read.
 *
 * A deployment that still sets one stops at startup. A silent drop would
 * narrow what the installation serves, and the person who runs it would only
 * find out at the next sign-in.
 */
const removedVariables: readonly (readonly [string, string])[] = [
  [
    'NOTESAPP_ALLOWED_HOSTS',
    'this installation does not read a host list. Name each full origin, with its scheme and its port, in NOTESAPP_ORIGIN and NOTESAPP_ADDITIONAL_ORIGINS.',
  ],
];

const configSchema: SchemaObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: [...variables],
  properties: {
    NOTESAPP_ORIGIN: {
      type: 'string',
      format: 'uri',
      pattern: '^https?://',
      maxLength: 256,
    },
    NOTESAPP_DATABASE_URL: {
      type: 'string',
      pattern: '^postgres(ql)?://',
      maxLength: 1024,
    },
    NOTESAPP_AUTH_DATABASE_URL: {
      type: 'string',
      pattern: '^postgres(ql)?://',
      maxLength: 1024,
    },
    NOTESAPP_STORAGE_ROOT: { type: 'string', pattern: '^/', maxLength: 1024 },
    // A short secret cannot protect a session cookie.
    NOTESAPP_AUTH_SECRET: { type: 'string', minLength: 32, maxLength: 512 },
    // The shape of one entry is decided by `served-origins.ts`, which refuses
    // a value that is not exactly one origin and names what to write instead.
    NOTESAPP_ADDITIONAL_ORIGINS: { type: 'string', maxLength: 1024 },
    NOTESAPP_LOG_LEVEL: { type: 'string', enum: [...logLevels] },
    NOTESAPP_MAX_BODY_BYTES: positiveInteger,
    NOTESAPP_MAX_HEADER_BYTES: positiveInteger,
    NOTESAPP_REQUEST_TIMEOUT_MS: positiveInteger,
    NOTESAPP_SMTP_URL: {
      type: 'string',
      pattern: '^smtps?://',
      maxLength: 1024,
    },
    NOTESAPP_MAIL_FROM: { type: 'string', minLength: 3, maxLength: 320 },
    NOTESAPP_SESSION_MAX_AGE_S: positiveInteger,
    NOTESAPP_RATE_LIMIT_WINDOW_S: positiveInteger,
    NOTESAPP_RATE_LIMIT_MAX: positiveInteger,
    NOTESAPP_SHUTDOWN_GRACE_MS: wholeNumber,
    NOTESAPP_SHUTDOWN_DEADLINE_MS: positiveInteger,
  },
};

const validate = compileSchema<RawConfig>(configSchema);

/**
 * Reads and validates the configuration. The error names each rejected
 * variable and never repeats its value, so a log cannot leak a secret.
 */
export function loadServerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  const removed = removedVariables.flatMap(([name, advice]) => {
    const value = environment[name];
    return value === undefined || value === '' ? [] : [`${name}: ${advice}`];
  });
  if (removed.length > 0) throw new ConfigError(removed);
  const raw: Record<string, string> = { NOTESAPP_LOG_LEVEL: 'info' };
  for (const name of [...variables, ...optionalVariables]) {
    const value = environment[name];
    if (value !== undefined && value !== '') raw[name] = value;
  }
  if (!validate(raw))
    throw new ConfigError(
      describeIssues(validate.errors).map(
        (issue) => `${issue.path}: ${issue.message}`,
      ),
    );
  const mail =
    raw.NOTESAPP_SMTP_URL === undefined
      ? null
      : {
          smtpUrl: raw.NOTESAPP_SMTP_URL,
          from: raw.NOTESAPP_MAIL_FROM ?? '',
        };
  const served = readServedOrigins(
    raw.NOTESAPP_ORIGIN,
    raw.NOTESAPP_ADDITIONAL_ORIGINS,
  );
  if (!served.ok) throw new ConfigError(served.issues);
  const [canonical] = served.origins;
  if (canonical === undefined)
    throw new ConfigError([
      'NOTESAPP_ORIGIN: name the origin of this installation.',
    ]);
  const shutdown = {
    gracePeriodMs:
      raw.NOTESAPP_SHUTDOWN_GRACE_MS === undefined
        ? defaultShutdownGraceMs
        : Number(raw.NOTESAPP_SHUTDOWN_GRACE_MS),
    deadlineMs:
      raw.NOTESAPP_SHUTDOWN_DEADLINE_MS === undefined
        ? defaultShutdownDeadlineMs
        : Number(raw.NOTESAPP_SHUTDOWN_DEADLINE_MS),
  };
  const partial: string[] = [];
  if (shutdown.deadlineMs <= shutdown.gracePeriodMs)
    partial.push(
      'NOTESAPP_SHUTDOWN_DEADLINE_MS: the stop deadline must be longer than NOTESAPP_SHUTDOWN_GRACE_MS.',
    );
  if (mail !== null && mail.from === '')
    partial.push(
      'NOTESAPP_MAIL_FROM: a mail transport also needs a sender address.',
    );
  if (raw.NOTESAPP_AUTH_DATABASE_URL === raw.NOTESAPP_DATABASE_URL)
    partial.push(
      'NOTESAPP_AUTH_DATABASE_URL: the identity connection must use its own role, not the runtime role.',
    );
  if (partial.length > 0) throw new ConfigError(partial);
  return {
    origin: canonical,
    databaseUrl: raw.NOTESAPP_DATABASE_URL,
    authDatabaseUrl: raw.NOTESAPP_AUTH_DATABASE_URL,
    storageRoot: raw.NOTESAPP_STORAGE_ROOT,
    authSecret: raw.NOTESAPP_AUTH_SECRET,
    servedOrigins: served.origins,
    logLevel: isLogLevel(raw.NOTESAPP_LOG_LEVEL)
      ? raw.NOTESAPP_LOG_LEVEL
      : 'info',
    limits: {
      bodyBytes: Number(raw.NOTESAPP_MAX_BODY_BYTES),
      headerBytes: Number(raw.NOTESAPP_MAX_HEADER_BYTES),
      requestTimeoutMs: Number(raw.NOTESAPP_REQUEST_TIMEOUT_MS),
    },
    rateLimit: {
      windowSeconds:
        raw.NOTESAPP_RATE_LIMIT_WINDOW_S === undefined
          ? 60
          : Number(raw.NOTESAPP_RATE_LIMIT_WINDOW_S),
      max:
        raw.NOTESAPP_RATE_LIMIT_MAX === undefined
          ? 100
          : Number(raw.NOTESAPP_RATE_LIMIT_MAX),
    },
    mail,
    sessionMaxAgeSeconds:
      raw.NOTESAPP_SESSION_MAX_AGE_S === undefined
        ? 60 * 60 * 24 * 7
        : Number(raw.NOTESAPP_SESSION_MAX_AGE_S),
    shutdown,
  };
}
