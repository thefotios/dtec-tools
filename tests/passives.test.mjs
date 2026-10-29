import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPassiveStore, normalizeSet, toSlots, fromSlots } from '../src/passives.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const KEY = 'class-combo-viewer:passives';
const memory = (initial) => {
  const data = new Map(initial ? Object.entries(initial) : []);
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)), data };
};
const throwing = (which) => ({
  getItem: () => {
    if (which === 'read') throw new Error('blocked');
    return null;
  },
  setItem: () => {
    if (which === 'write') throw new Error('blocked');
  },
});
const cls = (slug) => classes.find((c) => c.slug === slug);
const slot = (slug, level) => ({ cls: cls(slug), level });
const summary = (slots) => slots.map((s) => `${s.cls.slug}${s.level}`);

test('empty store has no sets, no last base, and unlockedOnly off', () => {
  const s = createPassiveStore(memory(), classes);
  assert.deepEqual(s.get('scout'), []);
  assert.equal(s.last, null);
  assert.equal(s.unlockedOnly, false);
});

test('set round-trips through storage', () => {
  const storage = memory();
  const a = createPassiveStore(storage, classes);
  a.set('scout', [slot('salvager', 3), slot('priest', 1)]);
  a.setLast('scout');
  a.setUnlockedOnly(true);
  const b = createPassiveStore(storage, classes);
  const expected = [slot('salvager', 3), slot('priest', 1)].sort((x, y) => classes.indexOf(x.cls) - classes.indexOf(y.cls));
  assert.deepEqual(summary(b.get('scout')), summary(expected));
  assert.equal(b.last, 'scout');
  assert.equal(b.unlockedOnly, true);
});

test('sets are independent per base', () => {
  const s = createPassiveStore(memory(), classes);
  s.set('scout', [slot('salvager', 2)]);
  s.set('crafter', [slot('priest', 3)]);
  assert.deepEqual(summary(s.get('scout')), ['salvager2']);
  assert.deepEqual(summary(s.get('crafter')), ['priest3']);
  assert.deepEqual(s.get('priest'), []);
});

test('saving stores canonical order regardless of input order', () => {
  const s = createPassiveStore(memory(), classes);
  const order = (slug) => classes.findIndex((c) => c.slug === slug);
  const input = [slot('salvager', 3), slot('priest', 1), slot('salvager', 1)];
  s.set('scout', input);
  const got = s.get('scout');
  const keys = got.map((x) => [order(x.cls.slug), x.level]);
  assert.deepEqual(keys, [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  assert.equal(got.length, 3);
});

test('an empty set removes the entry', () => {
  const storage = memory();
  const s = createPassiveStore(storage, classes);
  s.set('scout', [slot('salvager', 2)]);
  s.set('scout', []);
  assert.deepEqual(s.get('scout'), []);
  assert.deepEqual(JSON.parse(storage.data.get(KEY)).sets, {});
});

test('normalizeSet drops self, duplicates, unknown classes, bad levels, and caps at 3', () => {
  const entries = [
    { code: cls('scout').code, level: 1 },
    { code: cls('salvager').code, level: 2 },
    { code: cls('salvager').code, level: 2 },
    { code: 'nope', level: 1 },
    { code: cls('priest').code, level: 4 },
    { code: cls('priest').code, level: 0 },
    { code: cls('priest').code, level: '2' },
    { code: cls('crafter').code, level: 1 },
    { code: cls('priest').code, level: 1 },
    { code: cls('crafter').code, level: 2 },
  ];
  const out = normalizeSet(classes, 'scout', entries);
  assert.equal(out.length, 3);
  assert.ok(out.every((e) => e.code !== cls('scout').code));
  assert.equal(new Set(out.map((e) => `${e.code}${e.level}`)).size, 3);
});

test('the same passive may appear in different bases but not twice in one', () => {
  const s = createPassiveStore(memory(), classes);
  s.set('scout', [slot('salvager', 2)]);
  s.set('crafter', [slot('salvager', 2)]);
  s.set('priest', [slot('salvager', 2), slot('salvager', 2)]);
  assert.deepEqual(summary(s.get('scout')), ['salvager2']);
  assert.deepEqual(summary(s.get('crafter')), ['salvager2']);
  assert.deepEqual(summary(s.get('priest')), ['salvager2']);
});

test('a class is never saved as its own passive', () => {
  const s = createPassiveStore(memory(), classes);
  s.set('scout', [slot('scout', 1), slot('salvager', 1)]);
  assert.deepEqual(summary(s.get('scout')), ['salvager1']);
});

test('garbage storage yields an empty store', () => {
  for (const raw of ['not json', '{}', 'null', '[]', JSON.stringify({ v: 9, sets: {} }), JSON.stringify({ v: 1, sets: 'x' }), JSON.stringify({ v: 1, sets: null })]) {
    const s = createPassiveStore(memory({ [KEY]: raw }), classes);
    assert.deepEqual(s.get('scout'), [], raw);
    assert.equal(s.last, null, raw);
  }
});

test('partially valid payloads keep the valid parts', () => {
  const payload = { v: 1, last: 'ghost', unlockedOnly: 'yes', sets: { scout: [{ code: cls('salvager').code, level: 2 }, 'junk', null], ghost: [{ code: cls('priest').code, level: 1 }], crafter: 'x' } };
  const s = createPassiveStore(memory({ [KEY]: JSON.stringify(payload) }), classes);
  assert.deepEqual(summary(s.get('scout')), ['salvager2']);
  assert.deepEqual(s.get('crafter'), []);
  assert.equal(s.last, null);
  assert.equal(s.unlockedOnly, false);
});

test('setLast ignores unknown slugs and null clears it', () => {
  const s = createPassiveStore(memory(), classes);
  s.setLast('crafter');
  assert.equal(s.last, 'crafter');
  s.setLast('ghost');
  assert.equal(s.last, null);
  s.setLast('crafter');
  s.setLast(null);
  assert.equal(s.last, null);
});

test('blocked storage degrades to in-memory state without throwing', () => {
  for (const which of ['read', 'write']) {
    const s = createPassiveStore(throwing(which), classes);
    s.set('scout', [slot('salvager', 1)]);
    s.setLast('scout');
    s.setUnlockedOnly(true);
    assert.deepEqual(summary(s.get('scout')), ['salvager1']);
    assert.equal(s.last, 'scout');
    assert.equal(s.unlockedOnly, true);
  }
});

test('toSlots and fromSlots are inverse', () => {
  const entries = [{ code: cls('salvager').code, level: 2 }];
  assert.deepEqual(fromSlots(toSlots(classes, entries)), entries);
});

test('all returns saved sets keyed by class code and omits empty sets', () => {
  const s = createPassiveStore(memory(), classes);
  assert.deepEqual(s.all(), {});
  s.set('scout', [slot('salvager', 3), slot('priest', 1)]);
  s.set('crafter', [slot('priest', 2)]);
  s.set('crafter', []);
  const all = s.all();
  assert.deepEqual(Object.keys(all), [cls('scout').code]);
  assert.deepEqual(all[cls('scout').code], fromSlots(s.get('scout')));
});
