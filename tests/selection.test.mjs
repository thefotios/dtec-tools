import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPeopleStore } from '../src/people.mjs';
import { parseShare, parseImport } from '../src/code.mjs';
import { resolveLocation, importTarget } from '../src/selection.mjs';

const { classes } = JSON.parse(readFileSync(new URL('../data/classes.json', import.meta.url)));
const KEY = 'dtec:people';
const memory = (initial) => {
  const data = new Map(initial ? Object.entries(initial) : []);
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)) };
};
const code = (slug) => classes.find((c) => c.slug === slug).code;
const [MI, SC, REC, BO] = ['miner', 'scout', 'recruit', 'bountyhunter'].map(code);
const e = (...pairs) => pairs.map(([c, level]) => ({ code: c, level }));
const person = (id, name, extra = {}) => ({ id, name, base: null, levels: {}, sets: {}, rosterKnown: true, ...extra });
const payload = (over) => JSON.stringify({ v: 1, seq: 2, people: [], team: { name: '', members: [] }, selected: 'me', unlockedOnly: false, ...over });
const make = (people, over = {}) => createPeopleStore(memory({ [KEY]: payload({ people, ...over }) }), classes);
const share = (text) => parseShare(classes, text);
const at = (store, text, state = null) => resolveLocation(classes, store, { parsed: text === null ? null : share(text), state });
const imp = (store, text) => importTarget(classes, store, parseImport(classes, text));

test('a state naming a deleted person resolves to Me with nothing pending, whatever the path', () => {
  const s = make([person('me', ''), person('p1', 'Bob', { base: SC, levels: { [SC]: 3 } })]);
  const r = at(s, '/sc3?u=Gone', { person: 'p2', base: SC });
  assert.equal(r.kind, 'person');
  assert.equal(r.id, 'me');
  assert.equal(r.incoming, undefined);
  assert.equal(r.record, undefined);
  assert.equal(r.build, undefined);
});

test('a state after a rename selects by id on the stated base while the path carries the old name', () => {
  const s = make([person('me', ''), person('p1', 'Bobby', { base: MI, levels: { [MI]: 2, [SC]: 3 } })]);
  const r = at(s, '/sc3?u=Bob', { person: 'p1', base: SC });
  assert.deepEqual([r.kind, r.id, r.base, r.replaceUrl], ['person', 'p1', SC, true]);
});

test('/ restores the stored selection on its stored base, or Me when it is gone', () => {
  const s = make([person('me', ''), person('p1', 'Bob', { base: SC, levels: { [SC]: 3 } })], { selected: 'p1' });
  const r = at(s, null);
  assert.deepEqual([r.kind, r.id, r.base, r.replaceUrl], ['person', 'p1', SC, true]);
  s.remove('p1');
  const gone = at(s, null);
  assert.deepEqual([gone.kind, gone.id], ['person', 'me']);
});

test('a nameless build the person lacks is an unsaved build that names what Save raises', () => {
  const s = make([person('me', ''), person('p1', 'Bob')], { selected: 'p1' });
  const r = at(s, '/bo5-mi3');
  assert.deepEqual([r.kind, r.id, r.base, r.replaceUrl], ['unsaved', 'p1', BO, false]);
  assert.deepEqual(r.build, { base: BO, level: 5, passives: e([MI, 3]) });
  assert.deepEqual(r.raises, [{ code: MI, level: 3 }, { code: BO, level: 5 }]);
});

test('a nameless build already stored only selects its class', () => {
  const me = person('me', '', { base: MI, levels: { [MI]: 3, [REC]: 2 }, sets: { [MI]: e([REC, 2]) } });
  const r = at(make([me]), '/mi3-rec2');
  assert.deepEqual([r.kind, r.id, r.base, r.replaceUrl], ['person', 'me', MI, true]);
});

test('a nameless bare base keeps the stored set and is unsaved only when it raises the level', () => {
  const me = person('me', '', { base: MI, levels: { [MI]: 3, [REC]: 2 }, sets: { [MI]: e([REC, 2]) } });
  const same = at(make([me]), '/mi3');
  assert.deepEqual([same.kind, same.base], ['person', MI]);
  const low = person('me', '', { base: MI, levels: { [MI]: 2, [REC]: 2 }, sets: { [MI]: e([REC, 2]) } });
  const r = at(make([low]), '/mi3');
  assert.equal(r.kind, 'unsaved');
  assert.deepEqual(r.build, { base: MI, level: 3, passives: [] });
  assert.deepEqual(r.raises, [{ code: MI, level: 3 }]);
});

test('an unsaved build aims at the state target, else at the stored selection', () => {
  const s = make([person('me', ''), person('p1', 'Bob')]);
  const aimed = at(s, '/bo5-mi3', { target: 'p1' });
  assert.deepEqual([aimed.kind, aimed.id], ['unsaved', 'p1']);
  s.remove('p1');
  const gone = at(s, '/bo5-mi3', { target: 'p1' });
  assert.deepEqual([gone.kind, gone.id], ['unsaved', 'me']);
});

test('a roster segment in a nameless build is not part of the build', () => {
  const s = make([person('me', ''), person('p1', 'Bob')], { selected: 'p1' });
  const r = at(s, '/mi3-C?s=sc-mi2');
  assert.equal(r.kind, 'unsaved');
  assert.deepEqual(r.build, { base: MI, level: 3, passives: [] });
  assert.deepEqual(r.raises, [{ code: MI, level: 3 }]);
});

test('an unknown name is a temporary record with the link data and name', () => {
  const s = make([person('me', '')]);
  const r = at(s, '/sc4-mi2?u=Zed');
  assert.deepEqual([r.kind, r.replaceUrl], ['temporary', false]);
  assert.equal(r.record.name, 'Zed');
  assert.equal(r.record.base, SC);
  assert.deepEqual(r.record.levels, { [SC]: 4 });
  assert.deepEqual(r.record.sets, { [SC]: e([MI, 2]) });
  assert.equal(r.base, SC);
});

test('a saved name with equal data selects the person; different data holds a pending update', () => {
  const s = make([person('me', ''), person('p1', 'Bob', { base: SC, levels: { [SC]: 3 } })]);
  const same = at(s, '/sc3?u=bob');
  assert.deepEqual([same.kind, same.id, same.incoming, same.replaceUrl], ['person', 'p1', undefined, true]);
  const r = at(s, '/sc4?u=Bob');
  assert.deepEqual([r.kind, r.id, r.replaceUrl], ['update', 'p1', false]);
  assert.equal(r.incoming.player.levels[SC], 4);
});

test('a bare code for a saved name only compares that class', () => {
  const s = make([person('me', ''), person('p1', 'Bob', { base: SC, levels: { [SC]: 3, [MI]: 2 } })]);
  assert.equal(at(s, '/sc3?u=Bob').kind, 'person');
  assert.equal(at(s, '/sc3-mi2?u=Bob').kind, 'update');
});

test("Me's name with different passives holds a pending own update; equal data only selects Me", () => {
  const me = person('me', 'Fotios', { base: MI, levels: { [MI]: 3, [REC]: 2 }, sets: { [MI]: e([REC, 2]) } });
  const s = make([me]);
  const diff = at(s, '/mi3-rec1?u=Fotios');
  assert.deepEqual([diff.kind, diff.id, diff.replaceUrl], ['ownUpdate', 'me', false]);
  assert.ok(diff.incoming.player);
  const same = at(s, '/mi3-rec2?u=fotios');
  assert.deepEqual([same.kind, same.id, same.incoming, same.replaceUrl], ['person', 'me', undefined, true]);
});

test('pending outcomes and the unsaved build keep the URL', () => {
  const s = make([person('me', 'Fotios', { base: MI, levels: { [MI]: 3 } }), person('p1', 'Bob', { base: SC, levels: { [SC]: 3 } })]);
  for (const text of ['/sc4?u=Bob', '/mi4?u=Fotios', '/sc3?u=Zed', '/bo5-mi3']) assert.equal(at(s, text).replaceUrl, false, text);
});

test("a renamed person's old-name link is a temporary record and an import creates the old name", () => {
  const s = make([person('me', 'Fotios'), person('p1', 'Bob', { base: SC, levels: { [SC]: 3 } })]);
  s.rename('p1', 'Bobby');
  assert.equal(at(s, '/sc3?u=Bob').kind, 'temporary');
  assert.deepEqual(imp(s, '/sc3?u=Bob'), { kind: 'create', name: 'Bob' });
});

test('an invalid code keeps the stored selection and carries the parser notice', () => {
  const s = make([person('me', ''), person('p1', 'Bob')], { selected: 'p1' });
  const r = at(s, '/zzz9');
  assert.deepEqual([r.kind, r.id], ['invalid', 'p1']);
  assert.equal(r.notice, share('/zzz9').error);
  assert.ok(r.notice);
});

test('import targets with Me named', () => {
  const s = make([person('me', 'Fotios'), person('p1', 'Bob')]);
  assert.equal(imp(s, '/team/bob.sc3').kind, 'team');
  assert.deepEqual(imp(s, '/sc3?u=fotios'), { kind: 'own' });
  assert.deepEqual(imp(s, '/sc3?u=BOB'), { kind: 'person', id: 'p1' });
  assert.deepEqual(imp(s, '/sc3?u=Cyd'), { kind: 'create', name: 'Cyd' });
  assert.deepEqual(imp(s, '/sc3'), { kind: 'whose', name: '' });
  assert.deepEqual(imp(s, '/sc3?u=ab'), { kind: 'whose', name: 'ab' });
});

test('a roster code is own, and an unnamed Me turns an unsaved name into a prompt', () => {
  const s = make([person('me', ''), person('p1', 'Bob')]);
  assert.deepEqual(imp(s, 'BCDF'), { kind: 'own' });
  assert.deepEqual(imp(s, '/sc3?u=Bob'), { kind: 'person', id: 'p1' });
  assert.deepEqual(imp(s, '/sc3?u=Cyd'), { kind: 'whose', name: 'Cyd' });
  assert.deepEqual(imp(s, 'nonsense!!'), { error: parseImport(classes, 'nonsense!!').error });
});
