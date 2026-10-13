/** Service stress targets and strict measurement checks (record 0221). */
export const saveTargetMs = 200;
export const searchBudgetMs = 300;
const expectedSamples = 100;

/** Checks and selects the nearest-rank service percentile. */
export function serviceP95(samples: readonly number[]): number {
  if (
    samples.length !== expectedSamples ||
    Array.from(samples).some((sample) => !Number.isFinite(sample) || sample < 0)
  )
    throw new Error(
      'A service measurement needs 100 finite nonnegative samples.',
    );
  const sorted = [...samples].sort((left, right) => left - right);
  const value = sorted[Math.ceil(expectedSamples * 0.95) - 1];
  if (value === undefined)
    throw new Error('The service percentile is missing.');
  return value;
}

/**
 * Save target misses stay visible; Search budget misses stop the check.
 * @param {readonly number[]} saveSamples
 * @param {readonly number[]} searchSamples
 */
export function serviceExitCode(
  saveSamples: readonly number[],
  searchSamples: readonly number[],
): number {
  serviceP95(saveSamples);
  return serviceP95(searchSamples) < searchBudgetMs ? 0 : 1;
}
