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

/** Validated server configuration. */
export type ServerConfig = {
  /** Public origin of this deployment, used for cookie and CORS decisions. */
  readonly origin: string;
  /** PostgreSQL connection URL of the runtime role. */
  readonly databaseUrl: string;
  /** Directory that holds immutable attachment content. */
  readonly storageRoot: string;
  /** Secret that signs sessions and tokens. */
  readonly authSecret: string;
  /** Host header values that this deployment answers. */
  readonly allowedHosts: readonly string[];
  /** Level of the structured log. `silent` disables logging. */
  readonly logLevel: LogLevel;
  /** Request limits applied before a handler runs. */
  readonly limits: {
    readonly bodyBytes: number;
    readonly headerBytes: number;
    readonly requestTimeoutMs: number;
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
  'NOTESAPP_STORAGE_ROOT',
  'NOTESAPP_AUTH_SECRET',
  'NOTESAPP_ALLOWED_HOSTS',
  'NOTESAPP_LOG_LEVEL',
  'NOTESAPP_MAX_BODY_BYTES',
  'NOTESAPP_MAX_HEADER_BYTES',
  'NOTESAPP_REQUEST_TIMEOUT_MS',
] as const;

type RawConfig = Record<(typeof variables)[number], string>;

const positiveInteger = { type: 'string', pattern: '^[1-9][0-9]{0,9}$' };

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
    NOTESAPP_STORAGE_ROOT: { type: 'string', pattern: '^/', maxLength: 1024 },
    // A short secret cannot protect a session cookie or an agent token.
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
  for (const name of variables) {
    const value = environment[name];
    if (value !== undefined && value !== '') raw[name] = value;
  }
  if (!validate(raw))
    throw new ConfigError(
      describeIssues(validate.errors).map(
        (issue) => `${issue.path}: ${issue.message}`,
      ),
    );
  return {
    origin: raw.NOTESAPP_ORIGIN,
    databaseUrl: raw.NOTESAPP_DATABASE_URL,
    storageRoot: raw.NOTESAPP_STORAGE_ROOT,
    authSecret: raw.NOTESAPP_AUTH_SECRET,
    allowedHosts: raw.NOTESAPP_ALLOWED_HOSTS.split(',').map((host) =>
      host.trim().toLowerCase(),
    ),
    logLevel: isLogLevel(raw.NOTESAPP_LOG_LEVEL)
      ? raw.NOTESAPP_LOG_LEVEL
      : 'info',
    limits: {
      bodyBytes: Number(raw.NOTESAPP_MAX_BODY_BYTES),
      headerBytes: Number(raw.NOTESAPP_MAX_HEADER_BYTES),
      requestTimeoutMs: Number(raw.NOTESAPP_REQUEST_TIMEOUT_MS),
    },
  };
}
