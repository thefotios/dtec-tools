import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isValidName, cleanTeamName, NAME_RULE, ownedBase, ownImport } from '../src/players.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const code = (slug) => classes.find((c) => c.slug === slug).code;
const [MI, SC, SAL, PR] = ['miner', 'scout', 'salvager', 'priest'].map(code);

test('isValidName accepts and rejects the documented shapes', () => {
  for (const ok of ['bob', 'Bob_2', 'a1b2cr3', 'abc']) assert.equal(isValidName(ok), true, ok);
  for (const bad of ['_bob', 'bob_', 'b_o_b', 'ab', 'a'.repeat(21), 'bob.x', '', null, undefined]) assert.equal(isValidName(bad), false, String(bad));
  assert.equal(isValidName('a'.repeat(20)), true);
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

test('cleanTeamName trims and caps at 40 characters without trailing whitespace', () => {
  assert.equal(cleanTeamName('  Alpha  '), 'Alpha');
  assert.equal(cleanTeamName(`${'a'.repeat(39)}  b`), 'a'.repeat(39));
  assert.equal(cleanTeamName(null), '');
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
