import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isValidName, nameProblem, NAME_RULE, SELF_NAME, ownedBase, mePlayer, playerByName, linkOwner, ownImport, createPlayersStore } from '../src/players.mjs';
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
const make = (storage = memory()) => createPlayersStore(storage, classes);
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
  s.replaceTeam('A', [{ name: 'Bob', base: SC }, { name: 'ann', base: SC }]);
  s.remove('BOB');
  assert.equal(s.get('bob'), null);
  assert.deepEqual(names(s.team), ['ann']);
});

test('setMe re-keys memberships, conflicts leave me alone, claimAsMe takes over a saved player', () => {
  const s = make();
  assert.deepEqual(s.setMe('Fotios'), { ok: true });
  assert.ok(s.addMember('fotios', SC).ok);
  assert.deepEqual(s.setMe('thefotios'), { ok: true });
  assert.deepEqual(s.team.members, [{ name: 'thefotios', base: SC }]);
  assert.ok(s.setMe('x').error);
  assert.equal(s.me, 'thefotios');
  s.upsert(rec('bob'));
  s.addMember('bob', MI);
  assert.deepEqual(s.setMe('BOB'), { conflict: true });
  assert.equal(s.me, 'thefotios');
  assert.deepEqual(s.claimAsMe('bob'), { ok: true });
  assert.equal(s.me, 'bob');
  assert.equal(s.get('bob'), null);
  assert.deepEqual(s.team.members, [{ name: 'bob', base: SC }]);
});

test('claimAsMe keeps a saved player membership and sets me', () => {
  const s = make();
  s.upsert(rec('bob'));
  s.upsert(rec('ann'));
  s.replaceTeam('A', [{ name: 'bob', base: MI }, { name: 'ann', base: SC }]);
  s.claimAsMe('bob');
  assert.equal(s.me, 'bob');
  assert.deepEqual(s.team.members, [{ name: 'bob', base: MI }, { name: 'ann', base: SC }]);
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

test('team: name is trimmed and capped, member limits hold', () => {
  const s = make();
  assert.deepEqual(s.team, { name: '', members: [] });
  s.renameTeam('  Raid B ');
  assert.equal(s.team.name, 'Raid B');
  s.renameTeam('x'.repeat(50));
  assert.equal(s.team.name.length, 40);
  for (let i = 0; i < 8; i++) assert.ok(s.addMember(`p${i}x`, SC).ok);
  assert.ok(s.addMember('ninth', SC).error);
  s.removeMember('P0X');
  assert.equal(s.team.members.length, 7);
  assert.ok(s.addMember('dup', SC).ok);
  assert.ok(s.addMember('DUP', MI).error);
  assert.ok(s.addMember('', SC).error);
  assert.ok(s.addMember('ok1', 'zz').error);
  assert.ok(s.setMemberBase('Dup', MI).ok);
  assert.deepEqual(s.team.members.at(-1), { name: 'dup', base: MI });
  assert.ok(s.setMemberBase('nobody', MI).error);
  assert.ok(s.setMemberBase('dup', 'zz').error);
});

test('replaceTeam trims the name to 40 characters and cleans members', () => {
  const s = make();
  const members = [
    { name: 'bob', base: SC },
    { name: 'BOB', base: MI },
    { name: 'x', base: SC },
    { name: 'ann', base: 'zz' },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `p${i}x`, base: MI })),
  ];
  s.replaceTeam(`  ${'y'.repeat(50)}  `, members);
  assert.equal(s.team.name, 'y'.repeat(40));
  assert.equal(s.team.members.length, 8);
  assert.deepEqual(s.team.members[0], { name: 'bob', base: SC });
  assert.deepEqual(s.team.members[1], { name: 'p0x', base: MI });
  s.replaceTeam('', 'nope');
  assert.deepEqual(s.team, { name: '', members: [] });
});

test('addMember refuses Me while me is empty', () => {
  const s = make();
  assert.ok(s.addMember(s.me, SC).error);
  s.setMe('Fotios');
  assert.ok(s.addMember('Fotios', SC).ok);
});

test('the old team API is gone', () => {
  const s = make();
  for (const k of ['teams', 'active', 'setActive', 'createTeam', 'deleteTeam']) assert.equal(k in s, false, k);
});

test('state round-trips through storage and players sort by lowercase name', () => {
  const storage = memory();
  const a = make(storage);
  a.setMe('Fotios');
  a.upsert(rec('zed'));
  a.upsert(rec('Bob'));
  a.replaceTeam('A', [{ name: 'zed', base: SC }]);
  const b = make(storage);
  assert.equal(b.me, 'Fotios');
  assert.deepEqual(b.players.map((p) => p.name), ['Bob', 'zed']);
  assert.deepEqual(b.team, a.team);
  assert.deepEqual(b.team, { name: 'A', members: [{ name: 'zed', base: SC }] });
});

test('storage always holds v 1 with exactly one team that is active, readable by the previous load', () => {
  const storage = memory();
  const s = make(storage);
  s.setMe('Fotios');
  s.upsert(rec('zed'));
  s.replaceTeam('Raid', [{ name: 'zed', base: SC }]);
  const stored = JSON.parse(storage.data.get(KEY));
  assert.equal(stored.v, 1);
  assert.deepEqual(stored.teams, [{ id: 'team', name: 'Raid', members: [{ name: 'zed', base: SC }] }]);
  assert.equal(stored.active, 'team');
  assert.equal(stored.me, 'Fotios');
  assert.equal(stored.players.length, 1);
});

test('load keeps the active team of several stored teams and drops the rest; players and me are intact', () => {
  const teams = ['A', 'B', 'C'].map((n, i) => ({ id: `id${n}`, name: `Team ${n}`, members: [{ name: `m${n}x`, base: SC }] }));
  const storage = memory({ [KEY]: JSON.stringify({ v: 1, me: 'Ann', players: [rec('bob'), rec('cyd')], teams, active: 'idB' }) });
  const s = make(storage);
  assert.deepEqual(s.team, { name: 'Team B', members: [{ name: 'mBx', base: SC }] });
  assert.equal(s.me, 'Ann');
  assert.deepEqual(s.players.map((p) => p.name), ['bob', 'cyd']);
  s.renameTeam('Team B2');
  const stored = JSON.parse(storage.data.get(KEY));
  assert.equal(stored.teams.length, 1);
  assert.equal(stored.active, stored.teams[0].id);
  assert.equal(stored.players.length, 2);
});

test('load takes the first valid team when active is missing or unknown, an empty team when there are none', () => {
  const teams = [{ id: 'a', name: 'First', members: [] }, { id: 'b', name: 'Second', members: [] }];
  for (const active of [undefined, null, 'gone']) {
    const s = make(memory({ [KEY]: JSON.stringify({ v: 1, me: '', players: [], teams, active }) }));
    assert.equal(s.team.name, 'First', String(active));
  }
  const none = make(memory({ [KEY]: JSON.stringify({ v: 1, me: 'Ann', players: [rec('bob')], teams: [], active: null }) }));
  assert.deepEqual(none.team, { name: '', members: [] });
  assert.equal(none.players.length, 1);
});

test('blocked storage keeps state in memory; malformed and foreign versions load empty', () => {
  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const s = make(throwing);
  assert.ok(s.upsert(rec('bob')).ok);
  s.renameTeam('A');
  assert.equal(s.players.length, 1);
  assert.equal(s.team.name, 'A');
  for (const raw of ['not json', '{"v":2,"me":"bob","players":[],"teams":[]}', 'null', '{"v":1,"players":5,"teams":"x"}']) {
    const e = make(memory({ [KEY]: raw }));
    assert.deepEqual([e.me, e.players, e.team], ['', [], { name: '', members: [] }], raw);
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
  assert.deepEqual(s.team, { name: 'ok', members: [{ name: 'bob', base: SC }] });
});

test('a malformed team loads as an empty team with players and me intact', () => {
  const payload = { v: 1, me: 'Ann', players: [rec('bob')], teams: [null, 7, { name: 'noid', members: [] }], active: 'x' };
  const s = make(memory({ [KEY]: JSON.stringify(payload) }));
  assert.deepEqual(s.team, { name: '', members: [] });
  assert.equal(s.me, 'Ann');
  assert.equal(s.players.length, 1);
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

test('ownedBase: stored owned wins, then the player base, then the first owned class, else null', () => {
  const player = (base, levels) => ({ base, levels });
  assert.equal(ownedBase(classes, player(SC, { [MI]: 2, [SC]: 3 }), MI), MI);
  assert.equal(ownedBase(classes, player(SC, { [MI]: 2, [SC]: 3 }), PR), SC);
  assert.equal(ownedBase(classes, player(SC, { [MI]: 2, [SC]: 3 }), undefined), SC);
  assert.equal(ownedBase(classes, player(PR, { [SC]: 3, [MI]: 2 }), SAL), classes.find((c) => c.code === MI || c.code === SC).code);
  assert.equal(ownedBase(classes, player(PR, { [MI]: 0, [SC]: 0 }), MI), null);
  assert.equal(ownedBase(classes, player(null, {}), null), null);
});

test('claimAsMe with me and the claimed player on one team keeps one membership with the first entry base', () => {
  const s = make();
  s.setMe('fotios');
  s.upsert(rec('bob'));
  s.replaceTeam('A', [{ name: 'fotios', base: MI }, { name: 'bob', base: SC }, { name: 'ann', base: SAL }]);
  s.claimAsMe('bob');
  assert.equal(s.me, 'bob');
  assert.deepEqual(s.team.members, [{ name: 'bob', base: MI }, { name: 'ann', base: SAL }]);
});

test('nameProblem: format first, then my own name in any case, else null', () => {
  assert.equal(nameProblem('b', 'fotios'), NAME_RULE);
  assert.equal(nameProblem('', ''), NAME_RULE);
  assert.equal(nameProblem('FOTIOS', 'fotios'), SELF_NAME);
  assert.match(SELF_NAME, /Builds page/);
  assert.equal(nameProblem('bob', 'fotios'), null);
  assert.equal(nameProblem('fotios', ''), null);
});

test('linkOwner: my name in any case is me; a nameless bare code is me', () => {
  const s = make();
  s.setMe('Fotios');
  assert.equal(linkOwner(s, { name: 'fotios' }, false), 'me');
  assert.equal(linkOwner(s, { name: '' }, true), 'me');
});

test('linkOwner: a saved name in any case is library, also with a roster and sets', () => {
  const s = make();
  s.setMe('fotios');
  s.upsert(rec('Bob'));
  assert.equal(linkOwner(s, { name: 'BOB' }, true), 'library');
  assert.equal(linkOwner(s, { name: 'bob' }, false), 'library');
});

test('linkOwner: an unknown name or a nameless link with a roster is a visitor', () => {
  const s = make();
  s.setMe('fotios');
  s.upsert(rec('bob'));
  assert.equal(linkOwner(s, { name: 'carol' }, false), 'visitor');
  assert.equal(linkOwner(s, { name: '' }, false), 'visitor');
});

test('linkOwner: me wins over a saved player of the same name', () => {
  const s = make(memory({ [KEY]: JSON.stringify({ v: 1, me: 'bob', players: [{ ...rec('bob'), id: 'x' }], teams: [], active: null }) }));
  assert.equal(linkOwner(s, { name: 'Bob' }, false), 'me');
});

const e = (...pairs) => pairs.map(([code, level]) => ({ code, level }));
const parsed = (over) => ({
  player: { name: '', base: MI, levels: { [MI]: 2 }, sets: {} },
  hasRoster: false,
  hasSets: false,
  isLink: false,
  ...over,
});
const current = () => ({ levels: { [MI]: 4, [SC]: 3, [SAL]: 1 }, sets: { [MI]: e([SC, 1]), [SC]: e([SAL, 2]) } });

test('ownImport with roster and s replaces levels and every set', () => {
  const p = parsed({ hasRoster: true, hasSets: true, player: { name: 'Ann', base: MI, levels: { [MI]: 2, [PR]: 5 }, sets: { [MI]: e([SC, 3]), [PR]: e([SAL, 1]) } } });
  const r = ownImport(current(), p);
  assert.deepEqual(r.levels, { [MI]: 2, [PR]: 5 });
  assert.deepEqual(r.sets, { [MI]: e([SC, 3]), [PR]: e([SAL, 1]) });
  assert.equal(r.base, MI);
  assert.deepEqual(r.summary, { replacesRoster: true, replacesAllSets: true, replacesBaseSet: false, replacesBaseLevel: false, replacesExisting: true });
});

test('ownImport with roster, no s and a code keeps the other sets and replaces only the base set', () => {
  const p = parsed({ hasRoster: true, player: { name: '', base: MI, levels: { [MI]: 1, [PR]: 5 }, sets: { [MI]: e([SAL, 2]) } } });
  const r = ownImport(current(), p);
  assert.deepEqual(r.levels, { [MI]: 1, [PR]: 5 });
  assert.deepEqual(r.sets, { [MI]: e([SAL, 2]), [SC]: e([SAL, 2]) });
  assert.deepEqual(r.summary, { replacesRoster: true, replacesAllSets: false, replacesBaseSet: true, replacesBaseLevel: false, replacesExisting: true });
});

test('ownImport with roster, no s and a full link clears the other sets', () => {
  const p = parsed({ hasRoster: true, isLink: true, player: { name: 'Ann', base: MI, levels: { [MI]: 1, [PR]: 5 }, sets: { [MI]: e([SAL, 2]) } } });
  const r = ownImport(current(), p);
  assert.deepEqual(r.sets, { [MI]: e([SAL, 2]) });
  assert.equal(r.summary.replacesAllSets, true);
  assert.equal(r.summary.replacesBaseSet, false);
});

test('ownImport with a link that has s but no roster replaces all sets and only the base level', () => {
  const p = parsed({ hasSets: true, isLink: true, player: { name: 'Ann', base: MI, levels: { [MI]: 5 }, sets: { [PR]: e([SAL, 1]) } } });
  const r = ownImport(current(), p);
  assert.deepEqual(r.levels, { [MI]: 5, [SC]: 3, [SAL]: 1 });
  assert.deepEqual(r.sets, { [PR]: e([SAL, 1]) });
  assert.equal(r.summary.replacesRoster, false);
  assert.equal(r.summary.replacesAllSets, true);
});

test('ownImport bare code sets only the base level and the base set; no passives removes the base set', () => {
  const r = ownImport(current(), parsed({ player: { name: '', base: MI, levels: { [MI]: 2 }, sets: { [MI]: e([PR, 1]) } } }));
  assert.deepEqual(r.levels, { [MI]: 2, [SC]: 3, [SAL]: 1 });
  assert.deepEqual(r.sets, { [MI]: e([PR, 1]), [SC]: e([SAL, 2]) });
  assert.deepEqual(r.summary, { replacesRoster: false, replacesAllSets: false, replacesBaseSet: true, replacesBaseLevel: true, replacesExisting: true });
  const cleared = ownImport(current(), parsed({ player: { name: '', base: MI, levels: { [MI]: 4 }, sets: {} } }));
  assert.deepEqual(cleared.sets, { [SC]: e([SAL, 2]) });
  assert.equal(cleared.summary.replacesBaseLevel, false);
});

test('ownImport on empty current data reports nothing existing is replaced', () => {
  const none = { levels: {}, sets: {} };
  for (const p of [
    parsed({ hasRoster: true, hasSets: true, isLink: true, player: { name: 'Ann', base: MI, levels: { [MI]: 2, [SC]: 1 }, sets: { [MI]: e([SC, 1]) } } }),
    parsed({ hasRoster: true, player: { name: '', base: MI, levels: { [MI]: 2 }, sets: {} } }),
    parsed(),
  ]) {
    const r = ownImport(none, p);
    assert.equal(r.summary.replacesExisting, false);
    assert.deepEqual(r.levels, p.player.levels);
  }
});

test('ownImport does not mutate its inputs and returns copies', () => {
  const cur = current();
  const before = JSON.stringify(cur);
  const p = parsed({ hasRoster: true, hasSets: true, player: { name: 'Ann', base: MI, levels: { [MI]: 2 }, sets: { [MI]: e([SC, 3]) } } });
  const r = ownImport(cur, p);
  r.levels[MI] = 9;
  r.sets[MI][0].level = 9;
  assert.equal(JSON.stringify(cur), before);
  assert.equal(p.player.levels[MI], 2);
  assert.equal(p.player.sets[MI][0].level, 3);
});
