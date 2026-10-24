import { appendFileSync } from 'node:fs';

// The runner supplies these values to JavaScript actions, but not shell steps.
for (const name of ['ACTIONS_RUNTIME_TOKEN', 'ACTIONS_RESULTS_URL']) {
  const value = process.env[name];
  if (!value || /[\r\n]/.test(value)) {
    process.stdout.write(`${name} is unavailable. Remote cache is optional.\n`);
    continue;
  }
  if (name === 'ACTIONS_RUNTIME_TOKEN')
    process.stdout.write(`::add-mask::${value}\n`);
  appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
}
