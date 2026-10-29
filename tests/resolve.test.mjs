import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenize, resolve } from '../src/resolve.mjs';
import { newCode } from '../scripts/codes.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const slugOf = (list, token) => resolve(list, token)?.slug;
const groups = (run) => tokenize(run).map((g) => (g.valid ? [g.token, g.level] : ['invalid', g.raw]));

test('resolve: exact code, exact slug, unique prefix', () => {
  assert.equal(slugOf(classes, 'sc'), 'scout');
  assert.equal(slugOf(classes, 'salvager'), 'salvager');
  assert.equal(slugOf(classes, 'scou'), 'scout');
  assert.equal(slugOf(classes, 'c'), 'crafter');
});

test('resolve: case is ignored', () => {
  assert.equal(slugOf(classes, 'SAL'), 'salvager');
  assert.equal(slugOf(classes, 'Scout'), 'scout');
});

test('resolve: ambiguous, unknown, and empty tokens are invalid', () => {
  assert.equal(resolve(classes, 'pri'), null);
  assert.equal(resolve(classes, 'zzz'), null);
  assert.equal(resolve(classes, ''), null);
});

test('resolve: exact code wins over longer slug prefixes', () => {
  const list = [...classes, { code: 'ca', slug: 'cannoneer' }];
  assert.equal(slugOf(list, 'c'), 'crafter');
  assert.equal(slugOf(list, 'ca'), 'cannoneer');
});

test('resolve: with Prince added, prin is Princess and prince is Prince', () => {
  const list = [...classes, { code: 'prince', slug: 'prince' }];
  assert.equal(slugOf(list, 'prin'), 'princess');
  assert.equal(slugOf(list, 'prince'), 'prince');
});

test('tokenize: greedy letters+digit groups', () => {
  assert.deepEqual(groups('sal2sal3prie3'), [['sal', 2], ['sal', 3], ['prie', 3]]);
});

test('tokenize: levels outside 1-3 are invalid groups', () => {
  assert.deepEqual(groups('sal4'), [['invalid', 'sal4']]);
  assert.deepEqual(groups('sal0'), [['invalid', 'sal0']]);
});

test('tokenize: malformed chunks become one invalid group each', () => {
  assert.deepEqual(groups('sal22'), [['sal', 2], ['invalid', '2']]);
  assert.deepEqual(groups('sal2prie'), [['sal', 2], ['invalid', 'prie']]);
  assert.deepEqual(groups('prie!sal2'), [['invalid', 'prie!'], ['sal', 2]]);
});

test('tokenize: empty run yields no groups; uppercase is folded', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(groups('SAL2Sc1'), [['sal', 2], ['sc', 1]]);
});

test('newCode: shortest prefix not a code and not a prefix of another slug', () => {
  assert.equal(newCode('cannoneer', classes), 'ca');
  assert.equal(newCode('priestess', classes), 'prieste');
});

test('newCode: full slug when no proper prefix qualifies', () => {
  assert.equal(newCode('prince', classes), 'prince');
});

test('newCode: registered codes are not recomputed', () => {
  const list = [...classes, { code: 'ca', slug: 'cannoneer' }];
  assert.equal(newCode('cart', list), 'car');
});
