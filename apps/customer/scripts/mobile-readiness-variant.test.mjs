import test from 'node:test';
import assert from 'node:assert/strict';
import { selectReadinessVariant } from './mobile-readiness-variant.mjs';
test('staging preflight supports preview-only builds without requiring development configuration', () => {
  assert.equal(selectReadinessVariant(['--variant', 'preview'], 'staging'), 'preview');
  assert.equal(selectReadinessVariant([], 'staging'), 'development');
});
test('preflight preserves production and staging separation and rejects malformed selection', () => {
  assert.equal(selectReadinessVariant([], 'production'), 'production');
  assert.equal(selectReadinessVariant(['--variant', 'production'], 'production'), 'production');
  for (const [args, realm] of [
    [['--variant', 'production'], 'staging'],
    [['--variant', 'preview'], 'production'],
    [['--variant', 'development'], 'production'],
    [['--variant', 'unknown'], 'staging'],
    [['--variant'], 'staging'],
    [['--variant', 'preview', '--extra'], 'staging'],
    [['--unrecognized', 'preview'], 'staging'],
    [[], undefined],
  ]) assert.throws(() => selectReadinessVariant(args, realm));
});
