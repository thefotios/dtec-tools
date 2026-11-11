import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPeopleStore, saveBuild, isUnsavedBuild, buildRaises, nameProblem, cardModel, teamAddOffer, saveAsTarget, NAME_TAKEN } from '../src/people.mjs';
import { ownImport, NAME_RULE } from '../src/players.mjs';
import { parseImport } from '../src/code.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const KEY = 'dtec:people';
const LEGACY = ['class-combo-viewer:owned', 'class-combo-viewer:passives', 'class-combo-viewer:players'];
const memory = (initial) => {
  const data = new Map(initial ? Object.entries(initial) : []);
  const seen = [];
  return {
    getItem: (k) => (seen.push(['get', k]), data.get(k) ?? null),
    setItem: (k, v) => (seen.push(['set', k]), void data.set(k, String(v))),
    data,
    seen,
  };
};
const code = (slug) => classes.find((c) => c.slug === slug).code;
const [MI, SC, SAL, BO, C, REC] = ['miner', 'scout', 'salvager', 'bountyhunter', 'crafter', 'recruit'].map(code);
const make = (storage = memory()) => createPeopleStore(storage, classes);
const e = (...pairs) => pairs.map(([c, level]) => ({ code: c, level }));
const payload = (over) => JSON.stringify({ v: 1, seq: 0, people: [], team: { name: '', members: [] }, selected: 'me', unlockedOnly: false, ...over });
const person = (id, name, extra = {}) => ({ id, name, base: null, levels: {}, sets: {}, rosterKnown: true, ...extra });
const parsed = (over) => ({ player: { name: '', base: MI, levels: { [MI]: 2 }, sets: {} }, hasRoster: false, hasSets: false, isLink: false, ...over });
// A store with Bob (p1) and Ann (p2) on top of an unnamed Me.
const seeded = (over = {}) => {
  const storage = memory({
    [KEY]: payload({
      seq: 2,
      people: [person('me', ''), person('p1', 'Bob', { base: SC, levels: { [SC]: 3 } }), person('p2', 'Ann')],
      ...over,
    }),
  });
  return { storage, s: make(storage) };
};

test('Me is seeded on first load', () => {
  const s = make();
  assert.equal(s.people.length, 1);
  assert.deepEqual(s.me, { id: 'me', name: '', base: null, levels: {}, sets: {}, rosterKnown: true });
  assert.equal(s.selected, 'me');
  assert.deepEqual(s.team, { name: '', members: [] });
});

test('an empty person round-trips and survives un-owning the only class', () => {
  const storage = memory();
  const s = make(storage);
  const r = s.add('Ann');
  assert.ok(r.ok);
  const rec = s.get(r.id);
  assert.deepEqual(rec, { id: r.id, name: 'Ann', base: null, levels: {}, sets: {}, rosterKnown: true });
  assert.deepEqual(make(storage).get(r.id), rec);
  s.setLevel(r.id, SC, 3);
  s.setLevel(r.id, SC, 0);
  assert.deepEqual(make(storage).get(r.id).levels, {});
  assert.ok(make(storage).get(r.id));
});

test('rename keeps id, team place and selection; the name rules apply', () => {
  const { storage, s } = seeded({ team: { name: 'T', members: [{ id: 'p1', base: SC }] }, selected: 'p1' });
  assert.ok(s.rename('p1', 'Bobby').ok);
  const again = make(storage);
  assert.equal(again.get('p1').name, 'Bobby');
  assert.deepEqual(again.team.members, [{ id: 'p1', base: SC }]);
  assert.equal(again.selected, 'p1');
  assert.ok(again.rename('p1', 'BOBBY').ok);
  assert.ok(again.rename('p1', 'bobby').ok);
  assert.equal(again.rename('p2', 'bobby').error, NAME_TAKEN);
  assert.equal(again.rename('p2', 'ab').error, NAME_RULE);
  assert.ok(again.rename('me', 'Fotios').ok);
  assert.equal(again.rename('p2', 'fotios').error, NAME_TAKEN);
  assert.equal(again.rename('me', 'Ann').error, NAME_TAKEN);
  assert.ok(again.rename('me', '').ok);
  again.addMember('p1', SC);
  again.rename('me', 'Fotios');
  again.addMember('me', SC);
  assert.ok(again.rename('me', '').error);
  assert.equal(again.me.name, 'Fotios');
});

test('nameProblem is pure and reports null for a free name', () => {
  const people = [person('me', 'Fotios'), person('p1', 'Bob')];
  const team = { name: '', members: [] };
  assert.equal(nameProblem(people, team, null, 'Cy_1'), null);
  assert.equal(nameProblem(people, team, null, 'bob'), NAME_TAKEN);
  assert.equal(nameProblem(people, team, 'p1', 'BOB'), null);
  assert.equal(nameProblem(people, team, null, '_cy'), NAME_RULE);
});

test('deleting the selected person selects Me', () => {
  const { storage, s } = seeded({ selected: 'p1' });
  assert.ok(s.remove('p1').ok);
  assert.equal(s.get('p1'), null);
  assert.equal(s.selected, 'me');
  assert.equal(make(storage).selected, 'me');
});

test('deleting a team member keeps the others in order and the selection', () => {
  const { s } = seeded({
    people: [person('me', 'Fotios'), person('p1', 'Bob'), person('p2', 'Ann')],
    team: { name: 'T', members: [{ id: 'me', base: MI }, { id: 'p1', base: SC }, { id: 'p2', base: SAL }] },
  });
  s.remove('p1');
  assert.deepEqual(s.team.members, [{ id: 'me', base: MI }, { id: 'p2', base: SAL }]);
  assert.equal(s.selected, 'me');
  const before = JSON.stringify(s.me);
  assert.ok(s.remove('me').error);
  assert.equal(JSON.stringify(s.me), before);
  assert.equal(s.team.members.length, 2);
});

test('a corrupt payload loads as the fresh store', () => {
  const fresh = JSON.stringify(make().people);
  for (const raw of ['not json', payload({ v: 2 }).replace('"v":1', '"v":2'), payload({ people: 'bob' })]) {
    const s = make(memory({ [KEY]: raw }));
    assert.equal(JSON.stringify(s.people), fresh, raw);
    assert.equal(s.selected, 'me');
  }
});

test('only the people key is read or written', () => {
  const legacy = Object.fromEntries(LEGACY.map((k) => [k, `{"legacy":"${k}"}`]));
  const storage = memory(legacy);
  const s = make(storage);
  assert.equal(s.people.length, 1);
  const { id } = s.add('Ann');
  s.rename(id, 'Anna');
  s.remove(id);
  assert.ok(storage.seen.length >= 4);
  assert.ok(storage.seen.every(([, k]) => k === KEY), JSON.stringify(storage.seen));
  for (const k of LEGACY) assert.equal(storage.data.get(k), legacy[k]);
});

test('load cleans every field and keeps Me', () => {
  const storage = memory({
    [KEY]: JSON.stringify({
      v: 1,
      seq: 1,
      people: [
        person('p1', 'Bob', { base: 'zz', levels: { zz: 2, [MI]: 9, [SC]: 2 }, sets: { [SC]: e([MI, 1], [SC, 1]), zz: e([MI, 1]) } }),
        person('p1', 'Dup'),
        person('p2', 'bob'),
        person('p3', 'Cyd'),
        person('x9', 'Odd'),
      ],
      team: { name: 'T', members: [{ id: 'p1', base: SC }, { id: 'p1', base: MI }, { id: 'nope', base: SC }, { id: 'p3', base: 'zz' }, { id: 'me', base: SC }] },
      selected: 'gone',
    }),
  });
  const s = make(storage);
  assert.deepEqual(s.people.map((p) => p.id), ['me', 'p1', 'p3']);
  assert.deepEqual(s.get('p1'), person('p1', 'Bob', { base: null, levels: { [SC]: 2 }, sets: { [SC]: e([MI, 1]) } }));
  assert.deepEqual(s.team.members, [{ id: 'p1', base: SC }]);
  assert.equal(s.selected, 'me');
  assert.equal(s.add('Dee').id, 'p4');
});

test('load maps former codes in levels, sets, base and team member base to current codes', () => {
  const storage = memory({
    [KEY]: payload({
      seq: 1,
      people: [
        person('me', ''),
        person('p1', 'Bob', { base: 'c', levels: { c: 5, sal: 3, [MI]: 2 }, sets: { c: e(['sal', 2], ['rec', 1]), rec: e([MI, 1]) } }),
      ],
      team: { name: 'T', members: [{ id: 'p1', base: 'c' }] },
    }),
  });
  const s = make(storage);
  const bob = s.get('p1');
  assert.equal(bob.base, C);
  assert.deepEqual(bob.levels, { [C]: 5, [SAL]: 3, [MI]: 2 });
  assert.deepEqual(bob.sets, { [C]: e([REC, 1], [SAL, 2]), [REC]: e([MI, 1]) });
  assert.deepEqual(s.team.members, [{ id: 'p1', base: C }]);
});

test('an import never moves the selection, even when it creates a person', () => {
  const { s } = seeded({ selected: 'p2' });
  s.applyImport(parsed(), { id: 'p1' });
  assert.equal(s.selected, 'p2');
  const r = s.applyImport(parsed(), { name: 'Cyd' });
  assert.ok(r.created);
  assert.equal(s.selected, 'p2');
});

test('ids and the sequence load only as safe integers, so a corrupt huge id cannot strand new people', () => {
  const huge = 'p1000000000000000000000';
  const storage = memory({ [KEY]: payload({ seq: 1e21, people: [person('me', ''), person(huge, 'Big'), person('p1', 'Bob')] }) });
  const s = make(storage);
  assert.deepEqual(s.people.map((p) => p.id), ['me', 'p1']);
  const added = s.add('Dee');
  assert.equal(added.id, 'p2');
  assert.equal(make(storage).get('p2').name, 'Dee');
});

test('isMe is true only for the name Me holds, case ignored', () => {
  const s = make(memory({ [KEY]: payload({ seq: 1, people: [person('me', 'Fotios'), person('p1', 'Bob')] }) }));
  assert.equal(s.isMe('fotios'), true);
  assert.equal(s.isMe('Bob'), false);
  assert.equal(s.isMe(''), false);
  assert.equal(make().isMe(''), false);
});

test('level edits step back at the current max and make the roster known', () => {
  const { s } = seeded();
  s.applyImport(parsed({ player: { name: '', base: SC, levels: { [SC]: 3 }, sets: {} } }), { name: 'Cyd' });
  const cy = s.byName('Cyd');
  assert.equal(cy.rosterKnown, false);
  s.setLevel(cy.id, SC, 3);
  assert.equal(s.get(cy.id).levels[SC], 2);
  assert.equal(s.get(cy.id).rosterKnown, true);
  s.setLevel(cy.id, SC, 5);
  assert.equal(s.get(cy.id).levels[SC], 5);
  s.setLevel(cy.id, SC, 0);
  assert.equal(s.get(cy.id).levels[SC], undefined);
});

test('a full link replaces the record and a bare code updates only its class', () => {
  const { s } = seeded();
  s.setLevel('p1', MI, 4);
  s.setSet('p1', SC, e([SAL, 1]));
  const full = parsed({ hasRoster: true, hasSets: true, isLink: true, player: { name: 'Bob', base: MI, levels: { [MI]: 2, [BO]: 5 }, sets: { [MI]: e([SC, 3]) } } });
  assert.ok(s.applyImport(full, { name: 'bob' }).ok);
  assert.deepEqual(s.get('p1').levels, { [MI]: 2, [BO]: 5 });
  assert.deepEqual(s.get('p1').sets, { [MI]: e([SC, 3]) });
  assert.equal(s.get('p1').rosterKnown, true);
  assert.equal(s.selected, 'me');

  s.setLevel('p1', SAL, 1);
  s.applyImport(parseImport(classes, 'mi3-re2'), { id: 'p1' });
  assert.deepEqual(s.get('p1').levels, { [MI]: 3, [BO]: 5, [SAL]: 1 });
  assert.deepEqual(s.get('p1').sets, { [MI]: e([REC, 2]) });
  assert.equal(s.get('p1').base, MI);
  assert.equal(s.get('p1').rosterKnown, true);
});

test('a bare code keeps an unknown roster unknown, and creates an unknown person', () => {
  const { s } = seeded();
  const r = s.applyImport(parseImport(classes, 'mi3-re2'), { name: 'Cyd' });
  assert.ok(r.created);
  assert.equal(s.get(r.id).rosterKnown, false);
  s.applyImport(parseImport(classes, 'sc2'), { id: r.id });
  assert.equal(s.get(r.id).rosterKnown, false);
  assert.deepEqual(s.get(r.id).levels, { [MI]: 3, [SC]: 2 });
});

test('an import onto Me matches the own-import rule', () => {
  const { s } = seeded();
  s.setLevel('me', MI, 4);
  s.setLevel('me', SC, 3);
  s.setSet('me', MI, e([SC, 1]));
  const p = parsed({ hasRoster: true, player: { name: '', base: SC, levels: { [SC]: 1, [BO]: 5 }, sets: { [SC]: e([SAL, 2]) } } });
  const expected = ownImport({ levels: s.me.levels, sets: s.me.sets }, p);
  s.applyImport(p, { id: 'me' });
  assert.deepEqual(s.me.levels, expected.levels);
  assert.deepEqual(s.me.sets, expected.sets);
  assert.equal(s.me.base, expected.base);
});

test('a name-matched import keeps id, team position and team size', () => {
  const { s } = seeded({ team: { name: 'T', members: [{ id: 'p2', base: SAL }, { id: 'p1', base: SC }] } });
  const full = parsed({ hasRoster: true, isLink: true, player: { name: 'bob', base: MI, levels: { [MI]: 2 }, sets: {} } });
  const r = s.applyImport(full, { name: 'bob' });
  assert.equal(r.id, 'p1');
  assert.equal(r.created, false);
  assert.deepEqual(s.team.members, [{ id: 'p2', base: SAL }, { id: 'p1', base: SC }]);
  assert.equal(s.get('p1').name, 'Bob');
  assert.deepEqual(s.get('p1').levels, { [MI]: 2 });
});

test('an import with a taken or invalid new name changes nothing', () => {
  const { s } = seeded();
  assert.ok(s.applyImport(parsed(), { name: '_x' }).error);
  assert.equal(s.people.length, 3);
});

const person0 = (extra = {}) => ({ id: 'p1', name: 'Bob', base: null, levels: {}, sets: {}, rosterKnown: true, ...extra });

test('saveBuild with a bare base keeps the stored set', () => {
  const p = person0({ base: BO, levels: { [BO]: 5 }, sets: { [BO]: e([MI, 3]) } });
  const build = { base: BO, level: 5, passives: [] };
  assert.equal(isUnsavedBuild(classes, p, build), false);
  assert.deepEqual(saveBuild(classes, p, build).sets, { [BO]: e([MI, 3]) });
  const lower = person0({ base: BO, levels: { [BO]: 4 }, sets: { [BO]: e([MI, 3]) } });
  assert.equal(isUnsavedBuild(classes, lower, build), true);
  const next = saveBuild(classes, lower, build);
  assert.equal(next.levels[BO], 5);
  assert.deepEqual(next.sets, { [BO]: e([MI, 3]) });
  assert.deepEqual(buildRaises(classes, lower, build), [{ code: BO, level: 5 }]);
});

test('saveBuild on an empty person owns the base and the passive class', () => {
  const p = person0();
  const build = { base: BO, level: 5, passives: e([MI, 3]) };
  const next = saveBuild(classes, p, build);
  assert.deepEqual(next.levels, { [MI]: 3, [BO]: 5 });
  assert.equal(next.base, BO);
  assert.deepEqual(next.sets, { [BO]: e([MI, 3]) });
  assert.deepEqual(buildRaises(classes, p, build), [{ code: MI, level: 3 }, { code: BO, level: 5 }]);
  assert.equal(p.base, null);
  assert.deepEqual(p.levels, {});
});

test('saveBuild never lowers a level', () => {
  const p = person0({ levels: { [MI]: 5 } });
  const next = saveBuild(classes, p, { base: BO, level: 5, passives: e([MI, 3]) });
  assert.equal(next.levels[MI], 5);
  assert.equal(next.levels[BO], 5);
  const high = person0({ base: BO, levels: { [BO]: 5 } });
  assert.equal(saveBuild(classes, high, { base: BO, level: 3, passives: [] }).levels[BO], 5);
  assert.equal(isUnsavedBuild(classes, high, { base: BO, level: 3, passives: [] }), false);
});

test('saveBuild adds an unowned passive class and leaves the others alone', () => {
  const p = person0({ base: C, levels: { [C]: 5, [SC]: 2, [MI]: 1 } });
  const next = saveBuild(classes, p, { base: C, level: 5, passives: e([SC, 1], [SAL, 2], [SAL, 3]) });
  assert.deepEqual(next.levels, { [C]: 5, [SC]: 2, [SAL]: 3, [MI]: 1 });
  assert.equal(next.rosterKnown, true);
});

test('the store applies a build to one person only and keeps rosterKnown', () => {
  const { storage, s } = seeded();
  s.applyImport(parseImport(classes, 'sc2'), { name: 'Cyd' });
  const me = JSON.stringify(s.me);
  assert.ok(s.saveBuild('p2', { base: BO, level: 5, passives: e([MI, 3]) }).ok);
  const again = make(storage);
  assert.deepEqual(again.get('p2').levels, { [MI]: 3, [BO]: 5 });
  assert.deepEqual(again.get('p2').sets, { [BO]: e([MI, 3]) });
  assert.equal(JSON.stringify(again.me), me);
  const cy = again.byName('Cyd');
  again.saveBuild(cy.id, { base: SC, level: 3, passives: [] });
  assert.equal(again.get(cy.id).rosterKnown, false);
  assert.equal(again.get('p2').rosterKnown, true);
});

test('the list is Me first, then the others by lower-cased name', () => {
  const s = make(memory({ [KEY]: payload({ seq: 3, people: [person('p1', 'bob'), person('p2', 'Ann'), person('p3', 'cyd')] }) }));
  assert.deepEqual(s.people.map((p) => p.name), ['', 'Ann', 'bob', 'cyd']);
});

test('selection and the unlocked-only preference persist; unknown ids are ignored', () => {
  const { storage, s } = seeded();
  s.select('p2');
  s.select('nope');
  s.setUnlockedOnly(true);
  const again = make(storage);
  assert.equal(again.selected, 'p2');
  assert.equal(again.unlockedOnly, true);
});

test('team operations work by id', () => {
  const { s } = seeded({ people: [person('me', 'Fotios'), person('p1', 'Bob'), person('p2', 'Ann'), person('p3', '')].slice(0, 3) });
  assert.ok(s.addMember('p1', SC).ok);
  assert.ok(s.addMember('me', MI).ok);
  assert.ok(s.addMember('p1', MI).error);
  assert.ok(s.addMember('p1', 'zz').error);
  assert.ok(s.setMemberBase('p1', SAL).ok);
  assert.deepEqual(s.team.members, [{ id: 'p1', base: SAL }, { id: 'me', base: MI }]);
  s.renameTeam('  Crew  ');
  assert.equal(s.team.name, 'Crew');
  s.removeMember('p1');
  assert.deepEqual(s.team.members, [{ id: 'me', base: MI }]);
  s.replaceTeam('New', [{ id: 'p2', base: SC }, { id: 'ghost', base: SC }]);
  assert.deepEqual(s.team, { name: 'New', members: [{ id: 'p2', base: SC }] });
});

test('an unnamed person cannot join the team', () => {
  const s = make();
  assert.ok(s.addMember('me', MI).error);
});

test('blocked storage degrades to memory', () => {
  const noRead = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
  assert.equal(make(noRead).people.length, 1);
  const noWrite = { getItem: () => null, setItem: () => { throw new Error('full'); } };
  const s = make(noWrite);
  const { id } = s.add('Ann');
  s.setLevel(id, SC, 2);
  assert.equal(s.get(id).levels[SC], 2);
});

test('replaceLevels swaps one person classes, keeps their sets and makes the roster known', () => {
  const { s } = seeded();
  s.setSet('p1', SC, e([SAL, 2]));
  const r = s.replaceLevels('p1', { [MI]: 2, nope: 4, [SC]: 9 });
  assert.ok(r.ok);
  assert.deepEqual(s.get('p1').levels, { [MI]: 2 });
  assert.deepEqual(s.get('p1').sets, { [SC]: e([SAL, 2]) });
  assert.equal(s.get('p1').rosterKnown, true);
  assert.deepEqual(s.get('p2').levels, {});
  assert.ok(s.replaceLevels('p9', {}).error);
});

test('the card model names the person and their class, falling back to the first owned class', () => {
  const me = person('me', '');
  assert.deepEqual(cardModel(classes, me), { id: 'me', label: 'Me', code: null, level: 0, empty: true });
  assert.equal(cardModel(classes, { ...me, name: 'Fotios' }).label, 'Fotios');
  assert.deepEqual(cardModel(classes, person('p1', 'Ann', { levels: { [MI]: 3 } })), { id: 'p1', label: 'Ann', code: MI, level: 3, empty: false });
  assert.deepEqual(cardModel(classes, person('p2', 'Bob', { base: SC, levels: { [MI]: 3 } })), { id: 'p2', label: 'Bob', code: MI, level: 3, empty: false });
  assert.deepEqual(cardModel(classes, person('p3', 'Bob', { base: SC, levels: { [SC]: 2 } })), { id: 'p3', label: 'Bob', code: SC, level: 2, empty: false });
});

test('the add-to-team offer lists named people with a class and says why the others are left out', () => {
  const people = [person('me', ''), person('p1', 'Ann'), person('p2', 'Bob', { levels: { [MI]: 1 } }), person('p3', 'Cy', { levels: { [SC]: 1 } })];
  const offer = teamAddOffer(people, { name: '', members: [{ id: 'p3', base: SC }] });
  assert.deepEqual(offer.candidates.map((p) => p.id), ['p2']);
  assert.deepEqual(offer.left, [{ id: 'me', label: 'Me', reason: 'no name' }, { id: 'p1', label: 'Ann', reason: 'no classes' }]);
});

test('saveBuild replaces a changed passive set at equal levels and keeps the other bases', () => {
  const p = person0({ base: BO, levels: { [BO]: 5, [MI]: 3, [SC]: 1 }, sets: { [BO]: e([MI, 3]), [C]: e([SC, 1]) } });
  const build = { base: BO, level: 5, passives: e([SC, 1]) };
  assert.equal(isUnsavedBuild(classes, p, build), true);
  const next = saveBuild(classes, p, build);
  assert.deepEqual(next.sets[BO], e([SC, 1]));
  assert.deepEqual(next.sets[C], e([SC, 1]));
  assert.deepEqual(buildRaises(classes, p, build), []);
});

test('store guards report their error and leave the data untouched', () => {
  const { storage, s } = seeded({ team: { name: 'T', members: [{ id: 'p1', base: SC }] } });
  const before = storage.data.get(KEY);
  assert.deepEqual(s.setBase('nope', SC), { error: 'Unknown person' });
  assert.deepEqual(s.setBase('p1', 'zz'), { error: 'Unknown base class' });
  assert.deepEqual(s.setLevel('nope', SC, 2), { error: 'Unknown class' });
  assert.deepEqual(s.setLevel('p1', 'zz', 2), { error: 'Unknown class' });
  assert.deepEqual(s.setLevel('p1', SC, 6), { error: 'Level must be 1 to 5' });
  assert.deepEqual(s.setMemberBase('p1', 'zz'), { error: 'Unknown base class' });
  assert.deepEqual(s.setMemberBase('p2', SC), { error: 'Not on this team' });
  assert.deepEqual(s.applyImport(parsed(), { id: 'nope' }), { error: 'Unknown person' });
  assert.deepEqual(s.saveBuild('nope', { base: BO, level: 5, passives: [] }), { error: 'Unknown person' });
  assert.deepEqual(s.saveBuild('p1', { base: 'zz', level: 5, passives: [] }), { error: 'Unknown base class' });
  assert.equal(storage.data.get(KEY), before);
});

test('a team holds at most eight members', () => {
  const people = [person('me', '')];
  for (let i = 1; i <= 9; i += 1) people.push(person(`p${i}`, `Pal${i}`));
  const { s } = seeded({ seq: 9, people, team: { name: 'T', members: people.slice(1, 9).map((p) => ({ id: p.id, base: SC })) } });
  assert.equal(s.team.members.length, 8);
  assert.deepEqual(s.addMember('p9', SC), { error: 'A team holds at most 8 members' });
  assert.equal(s.team.members.length, 8);
});

test('saveAsTarget resolves the typed name', () => {
  const { s } = seeded();
  assert.deepEqual(saveAsTarget(s, ''), { error: 'Enter a name' });
  assert.deepEqual(saveAsTarget(s, '  '), { error: 'Enter a name' });
  assert.deepEqual(saveAsTarget(s, 'bOB'), { id: 'p1' });
  assert.deepEqual(saveAsTarget(s, 'me'), { id: 'me' });
  assert.deepEqual(saveAsTarget(s, 'ME'), { id: 'me' });
  assert.deepEqual(saveAsTarget(s, 'Zed'), { create: 'Zed' });
  assert.deepEqual(saveAsTarget(s, '_x'), { error: NAME_RULE });
});

test('saveAsTarget matches the name Me holds', () => {
  const { s } = seeded();
  s.rename('me', 'Fotios');
  assert.deepEqual(saveAsTarget(s, 'fotios'), { id: 'me' });
  assert.deepEqual(saveAsTarget(s, 'Me'), { id: 'me' });
});

test('saveBuildAs creates a new person with the build and leaves Me alone', () => {
  const { storage, s } = seeded();
  const me = JSON.stringify(s.me);
  const build = { base: BO, level: 5, passives: e([MI, 3]) };
  const r = s.saveBuildAs({ create: 'Dee' }, build);
  assert.ok(r.ok);
  const again = make(storage);
  const dee = again.byName('Dee');
  assert.equal(dee.id, r.id);
  assert.deepEqual(dee.levels, { [MI]: 3, [BO]: 5 });
  assert.equal(dee.base, BO);
  assert.equal(JSON.stringify(again.me), me);
  assert.deepEqual(s.saveBuildAs({ id: 'p1' }, build), { ok: true, id: 'p1' });
  assert.deepEqual(s.saveBuildAs({ create: '_x' }, build), { error: NAME_RULE });
});
