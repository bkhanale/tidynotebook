/**
 * Public entry point of the generated notesapp HTTP client.
 *
 * Every application HTTP call uses an operation exported here. No consumer may
 * import a file under `src/generated/` directly.
 */
export * from './generated/index.ts';
export {
  configureClient,
  normalizeProblem,
  type TokenProvider,
} from './configure.ts';
