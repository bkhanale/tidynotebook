import assert from 'node:assert/strict';
import test from 'node:test';
import {
  saveTargetMs,
  searchBudgetMs,
  serviceExitCode,
  serviceP95,
} from './performance/service-policy.ts';
/** @param {number} value */
const samples = (value) => Array.from({ length: 100 }, () => value);

await test('a Save target miss stays measured and does not block', () => {
  assert.equal(saveTargetMs, 200);
  const saves = samples(537.65);
  assert.equal(serviceP95(saves), 537.65);
  assert.equal(serviceExitCode(saves, samples(215.06)), 0);
  assert.equal(serviceExitCode(samples(200), samples(299.99)), 0);
});

await test('Search retains its strict blocking budget', () => {
  assert.equal(searchBudgetMs, 300);
  assert.equal(serviceExitCode(samples(10), samples(300)), 1);
  assert.equal(serviceExitCode(samples(537.65), samples(301)), 1);
});

await test('nearest-rank p95 keeps all 100 samples without changing input', () => {
  const values = Array.from({ length: 100 }, (_, index) => 100 - index);
  const before = [...values];
  assert.equal(serviceP95(values), 95);
  assert.deepEqual(values, before);
});

await test('incomplete or invalid Save and Search measurements are fatal', () => {
  const valid = samples(10);
  const sparse = samples(10);
  Object.defineProperty(sparse, '0', { value: undefined });
  const invalid = [
    sparse,
    [],
    samples(10).slice(1),
    [...valid, 10],
    samples(NaN),
    samples(Infinity),
    samples(-1),
  ];
  for (const values of invalid) {
    assert.throws(() => serviceExitCode(values, valid));
    assert.throws(() => serviceExitCode(valid, values));
  }
  assert.equal(serviceExitCode(samples(0), samples(0)), 0);
});
