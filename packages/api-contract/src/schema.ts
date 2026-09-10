/**
 * Ajv 2020-12 access for schemas that are not part of the HTTP contract, for
 * example the server startup configuration.
 *
 * The contract's own validators live in `src/validators.ts`. Both use
 * the 2020-12 entry point, because the default Ajv entry point compiles
 * draft-07 and would silently accept a 2020-12 keyword it does not know.
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import ajvFormats from 'ajv-formats';
import type { ErrorObject, SchemaObject, ValidateFunction } from 'ajv';

const ajv = new Ajv2020({ allErrors: false, strict: true });
// Ajv formats ships CommonJS. Node binds a default import to `module.exports`,
// so the plugin function is reached through its `default` member.
ajvFormats.default(ajv);

/** One rejected value, named by JSON Pointer. The value itself is never kept. */
export type ValidationIssue = {
  readonly path: string;
  readonly message: string;
};

/** Compiles a schema once. The caller states the shape the schema enforces. */
export function compileSchema<T>(schema: SchemaObject): ValidateFunction<T> {
  return ajv.compile<T>(schema);
}

/**
 * Describes Ajv errors without copying any rejected value, so a problem
 * response and a log line cannot leak note content or a secret.
 */
export function describeIssues(
  errors: readonly ErrorObject[] | null | undefined,
): readonly ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath === '' ? '/' : error.instancePath,
    message: error.message ?? 'is invalid',
  }));
}
