/**
 * Compile-time proof that a consumer keeps exact optional property checking
 * against a generated request type.
 *
 * `packages/api-client` must set `exactOptionalPropertyTypes: false`, because
 * the vendor fetch runtime inside the generated output does not compile with
 * it. This file proves that the relaxed setting stays inside that package: a
 * consumer that keeps `exactOptionalPropertyTypes: true` still gets TS2375 or
 * TS2379 when it assigns `undefined` to an optional member of a generated
 * request type.
 *
 * `tools/check-exact-optional.test.mjs` compiles this file and fails when the
 * expected error disappears.
 */
import type { GetReadinessData } from '@notesapp/api-client';

declare const maybeDetail: 'summary' | 'full' | undefined;

// Expected: TS2375 or TS2379. An exact optional member rejects `undefined`.
export const query: NonNullable<GetReadinessData['query']> = {
  detail: maybeDetail,
};
