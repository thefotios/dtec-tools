import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCode, codeFits } from '../scripts/codes.mjs';

test('newCode takes the first letter plus the earliest later letter that is free', () => {
  assert.equal(newCode('cannoneer', []), 'ca');
  assert.equal(newCode('cannoneer', ['ca']), 'cn');
  assert.equal(newCode('cannoneer', ['ca', 'cn']), 'co');
  assert.equal(newCode('crafter', ['cr']), 'ca');
});

test('newCode is null when no pair is free and ignores unrelated codes', () => {
  assert.equal(newCode('ab', ['ab']), null);
  assert.equal(newCode('a', []), null);
  assert.equal(newCode('aba', ['ab']), 'aa');
  assert.equal(newCode('miner', ['sc', 'ra']), 'mi');
});

test('codeFits needs two lowercase letters: the slug first letter and a later slug letter', () => {
  assert.ok(codeFits('cr', 'crafter'));
  assert.ok(codeFits('ct', 'cart'));
  assert.ok(!codeFits('c', 'crafter'));
  assert.ok(!codeFits('cra', 'crafter'));
  assert.ok(!codeFits('rc', 'crafter'));
  assert.ok(!codeFits('cz', 'crafter'));
  assert.ok(!codeFits('Cr', 'crafter'));
  assert.ok(!codeFits('c1', 'crafter'));
});
