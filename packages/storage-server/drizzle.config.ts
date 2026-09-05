/**
 * Drizzle Kit configuration for schema generation.
 *
 * `pnpm db:generate` compares `src/schema.ts` with the journal in
 * `migrations/` and writes the next SQL file. It never connects to a database,
 * so no credential belongs here. Migration file names come from Drizzle; this
 * repository assigns no numbers by hand.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
