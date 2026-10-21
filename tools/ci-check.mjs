/** Require success for selected jobs and skipped for all other jobs.
 * @param {Record<string, { result: string, outputs?: Record<string, string> }>} jobs */
export function checkResults(jobs) {
  const scope = jobs.scope?.outputs;
  for (const key of ['source', 'image', 'workflows']) {
    if (!['true', 'false'].includes(scope?.[key] ?? ''))
      throw new Error(`Change scope has no valid ${key} output.`);
  }
  const selected = {
    scope: true,
    static: true,
    unit: scope?.source === 'true',
    integration: scope?.source === 'true',
    image: scope?.image === 'true',
    workflows: scope?.workflows === 'true',
  };
  for (const [name, required] of Object.entries(selected)) {
    if (jobs[name]?.result !== (required ? 'success' : 'skipped'))
      throw new Error(`${name} has no passing result for its selected scope.`);
  }
}

if (import.meta.main) checkResults(JSON.parse(process.env.RESULTS ?? '{}'));
