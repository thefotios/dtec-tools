// Selection: which person and build a location shows, and who a pasted input belongs to. Pure: the people store is only read.

import { isUnsavedBuild, buildRaises } from './people.mjs';
import { isValidName, sameName, ownImport } from './players.mjs';

const isClass = (classes, code) => classes.some((c) => c.code === code);

// The class a person is shown on: their stored base, else the first class they own.
export function shownBase(classes, person) {
  if (isClass(classes, person.base)) return person.base;
  return classes.find((c) => (person.levels[c.code] ?? 0) > 0)?.code ?? null;
}

// Levels and sets in a key-order-independent form, so equal data compares equal.
const canon = (levels, sets) =>
  JSON.stringify([
    Object.keys(levels).sort().map((k) => [k, levels[k]]),
    Object.keys(sets).filter((k) => sets[k].length).sort().map((k) => [k, sets[k].map((e) => [e.code, e.level])]),
  ]);

// Whether applying a parsed link to the person (the import merge rule) would change their levels or sets.
export function linkDiffers(person, parsed) {
  const next = ownImport({ levels: person.levels, sets: person.sets }, parsed);
  return canon(next.levels, next.sets) !== canon(person.levels, person.sets);
}

// The build a nameless link shows: its base, the base level, and the base's passive run (empty when the link has none).
const buildOf = (parsed) => ({ base: parsed.player.base, level: parsed.player.levels[parsed.player.base], passives: parsed.player.sets[parsed.player.base] ?? [] });

// What a load or popstate shows, as one outcome: { kind, id, base, replaceUrl, ... }.
//   person: that person on that base, from the store. ownUpdate / update: the person plus `incoming` (the parsed link) waiting for
//   a confirm. unsaved: the person plus `build` and `raises`. temporary: no stored person, a `record` for the link's name.
//   invalid: the stored selection plus a `notice`.
// replaceUrl says whether the address bar is rewritten to the person's share path; pending outcomes and unsaved builds keep the URL.
// `parsed` is the parseShare result, or null for the root path; `state` is history.state.
export function resolveLocation(classes, store, { parsed, state }) {
  const me = store.me;
  const personOutcome = (person, base) => ({ kind: 'person', id: person.id, base: base ?? shownBase(classes, person), replaceUrl: true });
  if (state?.person) {
    const person = store.get(state.person);
    return person ? personOutcome(person, isClass(classes, state.base) ? state.base : null) : personOutcome(me);
  }
  const stored = store.get(store.selected) ?? me;
  if (!parsed) return personOutcome(stored);
  if (parsed.error) return { ...personOutcome(stored), kind: 'invalid', notice: parsed.error };
  const { player } = parsed;
  if (!player.name) {
    const target = (state?.target && store.get(state.target)) || stored;
    const build = buildOf(parsed);
    if (!isUnsavedBuild(classes, target, build)) return personOutcome(target, build.base);
    return { kind: 'unsaved', id: target.id, base: build.base, build, raises: buildRaises(classes, target, build), replaceUrl: false };
  }
  const owner = me.name && sameName(player.name, me.name) ? me : store.byName(player.name);
  if (!owner) {
    const record = { id: 'temp', name: player.name, base: player.base, levels: player.levels, sets: player.sets, rosterKnown: parsed.hasRoster };
    return { kind: 'temporary', id: null, base: player.base, record, replaceUrl: false };
  }
  if (!linkDiffers(owner, parsed)) return personOutcome(owner, player.base);
  return { kind: owner.id === me.id ? 'ownUpdate' : 'update', id: owner.id, base: player.base, incoming: parsed, replaceUrl: false };
}

// Who a pasted input belongs to, from a parseImport result:
//   { kind: 'team', path } | { kind: 'own' } | { kind: 'person', id } | { kind: 'create', name } | { kind: 'whose', name } | { error }.
// A saved name is matched first, so a saved person is updated even while Me has no name. An unsaved valid name is created
// only while Me is named; otherwise, and for a missing or invalid name, the input needs asking about.
export function importTarget(classes, store, parsed) {
  if (parsed.error) return { error: parsed.error };
  if (parsed.kind === 'team') return { kind: 'team', path: parsed.path };
  if (parsed.kind === 'roster') return { kind: 'own' };
  const name = parsed.player.name;
  if (name && store.me.name && sameName(name, store.me.name)) return { kind: 'own' };
  const saved = name ? store.byName(name) : null;
  if (saved) return { kind: 'person', id: saved.id };
  if (name && isValidName(name) && store.me.name) return { kind: 'create', name };
  return { kind: 'whose', name };
}
