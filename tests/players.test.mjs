import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isValidName, mePlayer, playerByName, createPlayersStore } from '../src/players.mjs';
import { createPassiveStore } from '../src/passives.mjs';
import { createStore } from '../src/owned.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const KEY = 'class-combo-viewer:players';
const memory = (initial) => {
  const data = new Map(initial ? Object.entries(initial) : []);
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)), data };
};
const code = (slug) => classes.find((c) => c.slug === slug).code;
const [MI, SC, SAL, PR] = ['miner', 'scout', 'salvager', 'priest'].map(code);
const counter = () => {
  let n = 0;
  return () => `t${++n}`;
};
const make = (storage = memory()) => createPlayersStore(storage, classes, { newId: counter() });
const rec = (name, base = SC, extra = {}) => ({ name, base, levels: { [base]: 3 }, sets: {}, ...extra });
const names = (team) => team.members.map((m) => m.name);

test('isValidName accepts and rejects the documented shapes', () => {
  for (const ok of ['bob', 'Bob_2', 'a1b2c3', 'abc']) assert.equal(isValidName(ok), true, ok);
  for (const bad of ['_bob', 'bob_', 'b_o_b', 'ab', 'a'.repeat(21), 'bob.x', '', null, undefined]) assert.equal(isValidName(bad), false, String(bad));
  assert.equal(isValidName('a'.repeat(20)), true);
});

test('upsert replaces a same-name record in another case', () => {
  const s = make();
  assert.deepEqual(s.upsert(rec('bob')), { ok: true, updated: false });
  assert.deepEqual(s.upsert(rec('BOB', MI)), { ok: true, updated: true });
  assert.equal(s.players.length, 1);
  assert.equal(s.players[0].name, 'BOB');
  assert.equal(s.players[0].base, MI);
  assert.equal(s.get('bob').base, MI);
});

test('upsert rejects bad records and normalizes sets', () => {
  const s = make();
  assert.ok(s.upsert(rec('bob', 'zz')).error);
  assert.ok(s.upsert({ name: 'bob', base: SC, levels: { [SC]: 0 }, sets: {} }).error);
  assert.ok(s.upsert({ name: 'bob', base: SC, levels: {}, sets: {} }).error);
  assert.ok(s.upsert(rec('b')).error);
  assert.equal(s.players.length, 0);
  const sets = { [SC]: [{ code: SC, level: 1 }, { code: SAL, level: 1 }, { code: SAL, level: 2 }, { code: PR, level: 1 }, { code: MI, level: 3 }] };
  assert.ok(s.upsert(rec('bob', SC, { sets })).ok);
  const set = s.get('bob').sets[SC];
  assert.equal(set.length, 3);
  assert.ok(set.every((e) => e.code !== SC));
});

test('remove drops memberships and keeps other members', () => {
  const s = make();
  s.upsert(rec('bob'));
  s.upsert(rec('ann'));
  const a = s.createTeam('A', [{ name: 'bob', base: SC }, { name: 'ann', base: SC }]);
  const b = s.createTeam('B', [{ name: 'Bob', base: SC }, { name: 'ann', base: SC }]);
  s.remove('BOB');
  assert.equal(s.get('bob'), null);
  assert.deepEqual(names(s.teams.find((t) => t.id === a)), ['ann']);
  assert.deepEqual(names(s.teams.find((t) => t.id === b)), ['ann']);
});

test('setMe re-keys memberships, conflicts leave me alone, claimAsMe takes over a saved player', () => {
  const s = make();
  assert.deepEqual(s.setMe('Fotios'), { ok: true });
  const t = s.createTeam('A', []);
  assert.ok(s.addMember(t, 'fotios', SC).ok);
  assert.deepEqual(s.setMe('thefotios'), { ok: true });
  assert.deepEqual(s.teams[0].members, [{ name: 'thefotios', base: SC }]);
  assert.ok(s.setMe('x').error);
  assert.equal(s.me, 'thefotios');
  s.upsert(rec('bob'));
  s.addMember(t, 'bob', MI);
  assert.deepEqual(s.setMe('BOB'), { conflict: true });
  assert.equal(s.me, 'thefotios');
  assert.deepEqual(s.claimAsMe('bob'), { ok: true });
  assert.equal(s.me, 'bob');
  assert.equal(s.get('bob'), null);
  assert.deepEqual(s.teams[0].members, [{ name: 'bob', base: SC }]);
});

test('claimAsMe keeps a saved player membership and sets me', () => {
  const s = make();
  s.upsert(rec('bob'));
  s.upsert(rec('ann'));
  const t = s.createTeam('A', [{ name: 'bob', base: MI }, { name: 'ann', base: SC }]);
  s.claimAsMe('bob');
  assert.equal(s.me, 'bob');
  assert.deepEqual(s.teams.find((x) => x.id === t).members, [{ name: 'bob', base: MI }, { name: 'ann', base: SC }]);
});

test('upsert rejects my own name; merge keeps other levels and sets', () => {
  const s = make();
  s.setMe('Fotios');
  assert.ok(s.upsert(rec('fOTIOS')).error);
  assert.equal(s.players.length, 0);
  const full = { name: 'bob', base: SC, levels: { [SC]: 3, [MI]: 2 }, sets: { [SC]: [{ code: SAL, level: 1 }], [MI]: [{ code: PR, level: 2 }] } };
  s.upsert(full);
  const bare = { name: 'Bob', base: MI, levels: { [MI]: 4 }, sets: { [MI]: [{ code: SAL, level: 3 }] } };
  assert.deepEqual(s.upsert(bare, { merge: true }), { ok: true, updated: true });
  const bob = s.get('bob');
  assert.equal(bob.base, MI);
  assert.deepEqual(bob.levels, { [SC]: 3, [MI]: 4 });
  assert.deepEqual(bob.sets[SC], [{ code: SAL, level: 1 }]);
  assert.deepEqual(bob.sets[MI], [{ code: SAL, level: 3 }]);
  s.upsert(rec('ann'));
  assert.ok(s.upsert(rec('ann', MI), { merge: true }).ok);
  assert.deepEqual(s.get('ann').levels, { [SC]: 3, [MI]: 3 });
  assert.deepEqual(s.upsert(rec('newbie'), { merge: true }), { ok: true, updated: false });
});

test('teams: ids come from the generator, new team activates, limits hold', () => {
  const s = make();
  const a = s.createTeam('  Raid A  ', []);
  assert.equal(a, 't1');
  assert.equal(s.active, 't1');
  assert.equal(s.teams[0].name, 'Raid A');
  assert.equal(s.createTeam('x'.repeat(50), []), 't2');
  assert.equal(s.teams[1].name.length, 40);
  assert.equal(s.active, 't2');
  s.renameTeam('t1', '  Raid B ');
  assert.equal(s.teams[0].name, 'Raid B');
  for (let i = 0; i < 8; i++) assert.ok(s.addMember('t1', `p${i}x`, SC).ok);
  assert.ok(s.addMember('t1', 'ninth', SC).error);
  assert.ok(s.addMember('t2', 'dup', SC).ok);
  assert.ok(s.addMember('t2', 'DUP', MI).error);
  assert.ok(s.addMember('t2', '', SC).error);
  assert.ok(s.addMember('t2', 'ok1', 'zz').error);
  assert.ok(s.addMember('nope', 'ok1', SC).error);
  assert.ok(s.setMemberBase('t2', 'Dup', MI).ok);
  assert.deepEqual(s.teams[1].members, [{ name: 'dup', base: MI }]);
  assert.ok(s.setMemberBase('t2', 'nobody', MI).error);
  s.removeMember('t2', 'DUP');
  assert.deepEqual(s.teams[1].members, []);
  assert.deepEqual(s.teams[0].members.length, 8);
});

test('addMember refuses Me while me is empty', () => {
  const s = make();
  const t = s.createTeam('A', []);
  assert.ok(s.addMember(t, s.me, SC).error);
  s.setMe('Fotios');
  assert.ok(s.addMember(t, 'Fotios', SC).ok);
});

test('deleteTeam of the active team activates the first remaining team or null', () => {
  const s = make();
  const a = s.createTeam('A', []);
  const b = s.createTeam('B', []);
  const c = s.createTeam('C', []);
  s.setActive(b);
  s.deleteTeam(c);
  assert.equal(s.active, b);
  s.deleteTeam(b);
  assert.equal(s.active, a);
  s.deleteTeam(a);
  assert.equal(s.active, null);
  assert.deepEqual(s.teams, []);
  s.setActive('missing');
  assert.equal(s.active, null);
});

test('state round-trips through storage and players sort by lowercase name', () => {
  const storage = memory();
  const a = make(storage);
  a.setMe('Fotios');
  a.upsert(rec('zed'));
  a.upsert(rec('Bob'));
  const t = a.createTeam('A', [{ name: 'zed', base: SC }]);
  const b = make(storage);
  assert.equal(b.me, 'Fotios');
  assert.deepEqual(b.players.map((p) => p.name), ['Bob', 'zed']);
  assert.equal(b.active, t);
  assert.deepEqual(b.teams, a.teams);
});

test('blocked storage keeps state in memory; malformed and foreign versions load empty', () => {
  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const s = make(throwing);
  assert.ok(s.upsert(rec('bob')).ok);
  s.createTeam('A', []);
  assert.equal(s.players.length, 1);
  assert.equal(s.teams.length, 1);
  for (const raw of ['not json', '{"v":2,"me":"bob","players":[],"teams":[]}', 'null', '{"v":1,"players":5,"teams":"x"}']) {
    const e = make(memory({ [KEY]: raw }));
    assert.deepEqual([e.me, e.players, e.teams, e.active], ['', [], [], null], raw);
  }
});

test('load discards malformed entries field by field', () => {
  const payload = {
    v: 1,
    me: 'bad name',
    players: [rec('bob'), rec('BOB'), rec('ab'), { name: 'ann', base: 'zz', levels: {}, sets: {} }, { name: 'cy_1', base: SC, levels: { [SC]: 9, [MI]: 2, zz: 1 }, sets: null }, null, 7],
    teams: [
      { id: 't1', name: ' ok ', members: [{ name: 'bob', base: SC }, { name: 'BOB', base: MI }, { name: 'x', base: SC }, { name: 'ann', base: 'zz' }] },
      { id: 't1', name: 'dup', members: [] },
      { name: 'noid', members: [] },
    ],
    active: 'gone',
  };
  const s = make(memory({ [KEY]: JSON.stringify(payload) }));
  assert.equal(s.me, '');
  assert.deepEqual(s.players.map((p) => p.name), ['bob']);
  assert.deepEqual(s.teams, [{ id: 't1', name: 'ok', members: [{ name: 'bob', base: SC }] }]);
  assert.equal(s.active, null);
});

test('mePlayer reflects the owned and passives stores on each call', () => {
  const owned = createStore(memory());
  const passives = createPassiveStore(memory(), classes);
  const s = make();
  assert.equal(mePlayer(classes, 'bob', owned, passives).base, null);
  owned.replace({ [SC]: 2, [MI]: 1 });
  let me = mePlayer(classes, 'bob', owned, passives);
  assert.equal(me.base, MI);
  assert.deepEqual(me.levels, { [SC]: 2, [MI]: 1 });
  passives.setLast('scout');
  passives.set('scout', [{ cls: classes.find((c) => c.code === SAL), level: 2 }]);
  me = mePlayer(classes, 'bob', owned, passives);
  assert.equal(me.base, SC);
  assert.deepEqual(me.sets, { [SC]: [{ code: SAL, level: 2 }] });
  assert.equal(me.name, 'bob');
  s.setMe('Bob');
  s.upsert(rec('ann'));
  assert.equal(playerByName(s, me, 'bOB'), me);
  assert.equal(playerByName(s, me, 'ANN').name, 'ann');
  assert.equal(playerByName(s, me, 'nobody'), null);
});

test('playerByName never matches Me while me is empty', () => {
  const s = make();
  s.upsert(rec('ann'));
  assert.equal(playerByName(s, { name: '' }, ''), null);
  assert.equal(playerByName(s, { name: '' }, 'ann').name, 'ann');
});
