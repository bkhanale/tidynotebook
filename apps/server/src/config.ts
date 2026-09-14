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
  return (logLevels as readonly string[]).includes(value);
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
  /** Public origin of this deployment, used for cookie and CORS decisions. */
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
   * Host header values that this deployment answers.
   *
   * When no list is configured, it holds the host of the origin only.
   */
  readonly allowedHosts: readonly string[];
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
 * An absent value has a stated meaning: no allowed-host list serves the host
 * of the origin and nothing else, no mail transport disables recovery by
 * email, and no provider values disable OpenID Connect. An empty value is
 * treated as absent, so a placeholder in a Compose file cannot enable a
 * half configured provider.
 */
const optionalVariables = [
  'NOTESAPP_ALLOWED_HOSTS',
  'NOTESAPP_SMTP_URL',
  'NOTESAPP_MAIL_FROM',
  'NOTESAPP_SESSION_MAX_AGE_S',
  'NOTESAPP_RATE_LIMIT_WINDOW_S',
  'NOTESAPP_RATE_LIMIT_MAX',
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

/**
 * The host names that this deployment serves.
 *
 * A deployment that names no list serves the host of its own origin and
 * nothing else. That is the only host that its cookies and its absolute URLs
 * can belong to, so it is the safe default for a fresh installation.
 */
function allowedHosts(
  configured: string | undefined,
  origin: string,
): readonly string[] {
  if (configured !== undefined) {
    return configured.split(',').map((host) => host.trim().toLowerCase());
  }
  return [new URL(origin).hostname.toLowerCase()];
}

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
    // A bracketed IPv6 literal such as `[::1]` is an allowed entry.
    NOTESAPP_ALLOWED_HOSTS: {
      type: 'string',
      pattern: '^[A-Za-z0-9.:_\\[\\]-]+(,[A-Za-z0-9.:_\\[\\]-]+)*$',
      maxLength: 1024,
    },
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
  const partial: string[] = [];
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
    origin: raw.NOTESAPP_ORIGIN,
    databaseUrl: raw.NOTESAPP_DATABASE_URL,
    authDatabaseUrl: raw.NOTESAPP_AUTH_DATABASE_URL,
    storageRoot: raw.NOTESAPP_STORAGE_ROOT,
    authSecret: raw.NOTESAPP_AUTH_SECRET,
    allowedHosts: allowedHosts(raw.NOTESAPP_ALLOWED_HOSTS, raw.NOTESAPP_ORIGIN),
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
  };
}
