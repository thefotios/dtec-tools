import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeRoster, decodeRoster, groupCode, createStore } from '../src/owned.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const decoded = (text, list = classes) => decodeRoster(list, text);
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

test('empty ownership encodes to A and decodes to an empty map', () => {
  assert.equal(encodeRoster(classes, {}), 'A');
  assert.deepEqual(decoded('A'), { owned: {}, notices: [] });
});

test('every class at levels 1 to 3 encodes to A plus one H per class', () => {
  const owned = Object.fromEntries(classes.map((c) => [c.code, [1, 2, 3]]));
  assert.equal(encodeRoster(classes, owned), 'A' + 'H'.repeat(classes.length));
});

test('first class at levels 1 to 5 encodes to A9 with trailing classes trimmed', () => {
  assert.equal(encodeRoster(classes, { [classes[0].code]: [1, 2, 3, 4, 5] }), 'A9');
  assert.deepEqual(decoded('A9').owned, { [classes[0].code]: [1, 2, 3, 4, 5] });
});

test('value map: letters first, digits for 22 to 31', () => {
  const one = (levels) => encodeRoster(classes, { [classes[0].code]: levels });
  assert.equal(one([1]), 'AB');
  assert.equal(one([1, 2]), 'AD');
  assert.equal(one([1, 2, 3, 4]), 'AS');
  assert.equal(one([5]), 'AT');
});

test('round trip over a pseudo-random ownership map', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const owned = {};
  for (const c of classes) {
    const levels = [1, 2, 3, 4, 5].filter(() => rnd() < 0.5);
    if (levels.length) owned[c.code] = levels;
  }
  assert.deepEqual(decoded(encodeRoster(classes, owned)).owned, owned);
});

test('decoding ignores case, hyphens, and spaces', () => {
  const want = decoded('A9');
  assert.deepEqual(decoded('a9'), want);
  assert.deepEqual(decoded('A-9'), want);
  assert.deepEqual(decoded('A 9'), want);
});

test('Crockford aliases: O is 0, I and L are 1', () => {
  assert.deepEqual(decoded('AO'), decoded('A0'));
  assert.deepEqual(decoded('AI'), decoded('A1'));
  assert.deepEqual(decoded('AL'), decoded('A1'));
});

test('code longer than the class list ignores extras with a notice; shorter leaves later classes unowned', () => {
  const r = decoded('A' + 'H'.repeat(classes.length) + 'HH');
  assert.equal(Object.keys(r.owned).length, classes.length);
  assert.equal(r.notices.length, 1);
  assert.match(r.notices[0], /2/);
  assert.deepEqual(decoded('AH').owned, { [classes[0].code]: [1, 2, 3] });
  assert.deepEqual(decoded('AH').notices, []);
});

test('unknown version or invalid characters are rejected with an error', () => {
  for (const bad of ['B9', 'AU', 'A!', '', '9']) {
    const r = decoded(bad);
    assert.ok(r.error, `expected error for ${JSON.stringify(bad)}`);
    assert.equal(r.owned, undefined);
  }
});

test('appending a class keeps existing codes decoding to the same map', () => {
  const owned = { [classes[0].code]: [1, 2, 3], [classes[5].code]: [4] };
  const code = encodeRoster(classes, owned);
  const grown = [...classes, { code: 'zz', slug: 'zzclass' }];
  assert.deepEqual(decoded(code, grown).owned, owned);
  assert.equal(encodeRoster(grown, owned), code);
});

test('groupCode groups in fours with hyphens', () => {
  assert.equal(groupCode('ABCDEFGHJ'), 'ABCD-EFGH-J');
  assert.equal(groupCode('A'), 'A');
});

test('store: storage that throws on read yields an empty map', () => {
  const store = createStore(throwing('read'));
  assert.deepEqual(store.owned, {});
  assert.equal(store.ownedOnly, false);
});

test('store: storage that throws on write keeps the in-memory map', () => {
  const store = createStore(throwing('write'));
  store.toggleLevel('mi', 2);
  assert.deepEqual(store.owned, { mi: [2] });
  store.setOwnedOnly(true);
  assert.equal(store.ownedOnly, true);
});

test('store: persists map and flag, and reloads them', () => {
  const storage = memory();
  const a = createStore(storage);
  a.toggleLevel('mi', 1);
  a.toggleLevel('mi', 3);
  a.setOwnedOnly(true);
  const b = createStore(storage);
  assert.deepEqual(b.owned, { mi: [1, 3] });
  assert.equal(b.ownedOnly, true);
});

test('store: toggling a level off removes it, and an empty class is dropped', () => {
  const store = createStore(memory());
  store.toggleLevel('mi', 2);
  store.toggleLevel('mi', 2);
  assert.deepEqual(store.owned, {});
});

test('store: name toggle marks level 1 or clears the row', () => {
  const store = createStore(memory());
  store.toggleClass('mi');
  assert.deepEqual(store.owned, { mi: [1] });
  store.toggleLevel('mi', 4);
  store.toggleClass('mi');
  assert.deepEqual(store.owned, {});
});

test('store: corrupt or wrong-version storage yields an empty map', () => {
  assert.deepEqual(createStore(memory({ 'class-combo-viewer:owned': '{nope' })).owned, {});
  assert.deepEqual(createStore(memory({ 'class-combo-viewer:owned': '{"v":99,"owned":{"mi":[1]}}' })).owned, {});
});

test('store: replace sets the whole map', () => {
  const store = createStore(memory());
  store.replace({ mi: [1, 2] });
  assert.deepEqual(store.owned, { mi: [1, 2] });
  assert.equal(store.has('mi', 2), true);
  assert.equal(store.has('mi', 3), false);
});
