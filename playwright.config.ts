import { availableParallelism } from 'node:os';
import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

/**
 * How many browser journeys run at the same time.
 *
 * One worker owns one application stack: a database of the test cluster, a
 * listening server, a storage directory, and a browser. Two of them halve the
 * wall clock on the smallest machine that runs this suite. A larger machine
 * takes one worker for each pair of cores, and four is the ceiling, because
 * the test database cluster serves every worker of every run.
 *
 * `tests/e2e/support/stack.ts` gives each worker its own stack, so a journey
 * never reads the notes of another worker.
 */
const workers = Math.min(
  4,
  Math.max(2, Math.floor(availableParallelism() / 2)),
);

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/playwright',
  // The journeys of one file share the stack of their worker, so they keep
  // their written order. Parallel work happens one file at a time per worker.
  fullyParallel: false,
  workers,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The workers share one machine, so a journey waits longer for its browser
  // than it does alone. The budget also holds the sign in retry of
  // `tests/e2e/support/account.ts`, which Firefox needs while it installs the
  // service worker. One assertion still has to settle inside ten seconds.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/playwright/results.json' }],
  ],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'phone-390',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'tablet-768',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
      },
    },
  ],
});
