// People: one store holding every person record, the team, the selected person and the picker preference.
// A record is { id, name, base, levels, sets, rosterKnown }: id is 'me' or 'p<n>' and never changes, base is a class code or null,
// levels maps class code to max level 1-5, sets maps class code to a passive set of { code, level } entries.

import { normalizeSet } from './passives.mjs';
import { classByCode } from './code.mjs';
import { cleanMax } from './owned.mjs';
import { isValidName, sameName, lower, copySets, cleanTeamName, ownImport, ownedBase, MAX_MEMBERS, NAME_RULE } from './players.mjs';

const STORAGE_KEY = 'dtec:people';
const STORE_VERSION = 1;
export const ME_ID = 'me';

export const NAME_TAKEN = 'That name is already used by someone else';

const emptyTeam = () => ({ name: '', members: [] });
const freshMe = () => ({ id: ME_ID, name: '', base: null, levels: {}, sets: {}, rosterKnown: true });
// A stored id is 'p' and a safe-integer counter, so the next id built from the sequence always reads back.
const idNumber = (id) => (/^p\d+$/.test(id) && Number.isSafeInteger(Number(id.slice(1))) ? Number(id.slice(1)) : -1);

// Canonical record for an id and raw data: known classes and levels 1-5 only, sets cleaned for their base class.
// Former class codes read as the class's current code.
function cleanRecord(classes, id, raw) {
  const current = (code) => (code == null ? null : (classByCode(classes, code)?.code ?? null));
  const levels = {};
  for (const [key, value] of Object.entries(raw?.levels ?? {})) {
    const code = current(key);
    if (code && cleanMax(value) > 0) levels[code] = value;
  }
  const sets = {};
  for (const [key, entries] of Object.entries(raw?.sets ?? {})) {
    const cls = classByCode(classes, key);
    if (!cls || !Array.isArray(entries)) continue;
    const set = normalizeSet(classes, cls.slug, entries.map((e) => ({ ...e, code: current(e?.code) })));
    if (set.length) sets[cls.code] = set;
  }
  const name = typeof raw?.name === 'string' ? raw.name : '';
  return { id, name, base: current(raw?.base), levels, sets, rosterKnown: raw?.rosterKnown !== false };
}

// Members keep the first occurrence per person, known named people and known bases only, at most eight.
function cleanMembers(classes, people, members) {
  const out = [];
  for (const m of Array.isArray(members) ? members : []) {
    const person = people.find((p) => p.id === m?.id);
    const base = m?.base == null ? null : classByCode(classes, m.base)?.code;
    if (!person?.name || !base || out.some((o) => o.id === person.id)) continue;
    out.push({ id: person.id, base });
    if (out.length === MAX_MEMBERS) break;
  }
  return out;
}

// Cleans a stored payload field by field; anything unreadable or of another version gives one unnamed Me.
function load(storage, classes) {
  const fresh = { seq: 0, people: [freshMe()], team: emptyTeam(), selected: ME_ID, unlockedOnly: false, allClasses: false };
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY));
    if (parsed?.v !== STORE_VERSION || !Array.isArray(parsed.people)) return fresh;
    const rawMe = parsed.people.find((r) => r?.id === ME_ID);
    const me = rawMe ? cleanRecord(classes, ME_ID, rawMe) : freshMe();
    if (me.name !== '' && !isValidName(me.name)) me.name = '';
    const people = [me];
    for (const raw of parsed.people) {
      if (typeof raw?.id !== 'string' || idNumber(raw.id) < 0 || people.some((p) => p.id === raw.id)) continue;
      const record = cleanRecord(classes, raw.id, raw);
      if (!isValidName(record.name) || people.some((p) => p.name && sameName(p.name, record.name))) continue;
      people.push(record);
    }
    const seq = Math.max(Number.isSafeInteger(parsed.seq) && parsed.seq > 0 ? parsed.seq : 0, ...people.map((p) => idNumber(p.id)));
    const team = { name: cleanTeamName(parsed.team?.name), members: cleanMembers(classes, people, parsed.team?.members) };
    const selected = people.some((p) => p.id === parsed.selected) ? parsed.selected : ME_ID;
    return { seq, people, team, selected, unlockedOnly: parsed.unlockedOnly === true, allClasses: parsed.allClasses === true };
  } catch {
    return fresh;
  }
}

// Why `name` cannot be used for the person `id` (null for a new person), or null when it can. Names follow the format rule and are
// unique across everyone, case ignored, except that a person may change the case of their own name. Me may have no name unless on the team.
export function nameProblem(people, team, id, name) {
  if (id === ME_ID && name === '') return team.members.some((m) => m.id === ME_ID) ? 'Your name is needed while you are on the team' : null;
  if (!isValidName(name)) return NAME_RULE;
  if (people.some((p) => p.id !== id && p.name && sameName(p.name, name))) return NAME_TAKEN;
  return null;
}

// Pure: what a person card shows. The class is the stored base while owned, else the first owned class; a person who owns none is empty.
// An unnamed Me reads "Me".
export function cardModel(classes, person) {
  const code = ownedBase(classes, person, person.base);
  return { id: person.id, label: person.name || (person.id === ME_ID ? 'Me' : ''), code, level: code ? person.levels[code] : 0, empty: !code };
}

// Pure: who the Team page can add: named people who own a class and are not on the team, and why each other person off the team is left out.
export function teamAddOffer(people, team) {
  const onTeam = new Set(team.members.map((m) => m.id));
  const off = people.filter((p) => !onTeam.has(p.id));
  const reason = (p) => (!p.name ? 'no name' : Object.keys(p.levels).length ? null : 'no classes');
  return {
    candidates: off.filter((p) => !reason(p)),
    left: off.filter(reason).map((p) => ({ id: p.id, label: p.name || 'Me', reason: reason(p) })),
  };
}

// Pure: the person after saving a build { base, level, passives }: the base class and every passive class are owned at least at the
// build's levels, nothing is lowered, and the base's set is replaced only when the build carries passives. The base becomes the person's base.
export function saveBuild(classes, person, build) {
  const base = classes.find((c) => c.code === build.base);
  if (!base) return person;
  const passives = normalizeSet(classes, base.slug, build.passives ?? []);
  const levels = { ...person.levels };
  levels[base.code] = Math.max(levels[base.code] ?? 0, build.level);
  for (const p of passives) levels[p.code] = Math.max(levels[p.code] ?? 0, p.level);
  const sets = copySets(person.sets);
  if (passives.length) sets[base.code] = passives;
  return { ...person, base: base.code, levels, sets };
}

const sameData = (a, b) => JSON.stringify([a.levels, a.sets]) === JSON.stringify([b.levels, b.sets]);

// A build is unsaved exactly when saving it would change the person's levels or sets; a different base alone is not a change.
export const isUnsavedBuild = (classes, person, build) => !sameData(person, saveBuild(classes, person, build));

// The class levels saving the build would raise, as { code, level } in class list order.
export function buildRaises(classes, person, build) {
  const next = saveBuild(classes, person, build);
  return classes.filter((c) => (next.levels[c.code] ?? 0) > (person.levels[c.code] ?? 0)).map((c) => ({ code: c.code, level: next.levels[c.code] }));
}

// Pure: who the Save as form's text names: { id } for a saved person (case ignored) or Me ("me" or Me's name), { create } for a valid
// new name, else { error }.
export function saveAsTarget(store, text) {
  const name = String(text ?? '').trim();
  if (!name) return { error: 'Enter a name' };
  const found = store.byName(name);
  if (found) return { id: found.id };
  if (lower(name) === 'me') return { id: ME_ID };
  const problem = store.nameProblem(null, name);
  return problem ? { error: problem } : { create: name };
}

// Reads and writes never throw: a blocked store degrades to in-memory state. Only the people key is touched.
export function createPeopleStore(storage, classes) {
  let { seq, people, team, selected, unlockedOnly, allClasses } = load(storage, classes);
  const save = () => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ v: STORE_VERSION, seq, people, team, selected, unlockedOnly, allClasses }));
    } catch {
      /* in-memory only */
    }
  };
  const hasCode = (code) => classes.some((c) => c.code === code);
  const find = (id) => people.find((p) => p.id === id) ?? null;
  const findByName = (name) => (name ? (people.find((p) => p.name && sameName(p.name, name)) ?? null) : null);
  const patch = (id, change) => {
    people = people.map((p) => (p.id === id ? { ...p, ...change } : p));
    save();
  };
  const cleaned = (id, record) => cleanRecord(classes, id, record);

  return {
    // Me first, then everyone else by lower-cased name.
    get people() {
      const others = people.filter((p) => p.id !== ME_ID).sort((a, b) => (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : 0));
      return [find(ME_ID), ...others];
    },
    get: (id) => find(id),
    byName: findByName,
    get me() {
      return find(ME_ID);
    },
    // Whether the name is the one Me holds, case ignored.
    isMe: (name) => findByName(name)?.id === ME_ID,
    get selected() {
      return selected;
    },
    // An unknown id is ignored.
    select(id) {
      if (!find(id) || id === selected) return;
      selected = id;
      save();
    },
    get unlockedOnly() {
      return unlockedOnly;
    },
    setUnlockedOnly(value) {
      const next = Boolean(value);
      if (next === unlockedOnly) return;
      unlockedOnly = next;
      save();
    },
    get allClasses() {
      return allClasses;
    },
    setAllClasses(value) {
      const next = Boolean(value);
      if (next === allClasses) return;
      allClasses = next;
      save();
    },
    nameProblem: (id, name) => nameProblem(people, team, id, name),
    // A person with no classes; the new person becomes the selection.
    add(name) {
      const problem = nameProblem(people, team, null, name);
      if (problem) return { error: problem };
      seq += 1;
      const id = `p${seq}`;
      people = [...people, { id, name, base: null, levels: {}, sets: {}, rosterKnown: true }];
      selected = id;
      save();
      return { ok: true, id };
    },
    rename(id, name) {
      if (!find(id)) return { error: 'Unknown person' };
      const problem = nameProblem(people, team, id, name);
      if (problem) return { error: problem };
      patch(id, { name });
      return { ok: true };
    },
    // Me cannot be deleted. The team loses the person and a deleted selection falls back to Me.
    remove(id) {
      if (id === ME_ID || !find(id)) return { error: 'Cannot delete' };
      people = people.filter((p) => p.id !== id);
      team = { ...team, members: team.members.filter((m) => m.id !== id) };
      if (selected === id) selected = ME_ID;
      save();
      return { ok: true };
    },
    // Clicking the current max steps back one level, so a class can return to unowned; 0 removes the class. Any edit makes the roster known.
    setLevel(id, code, n) {
      const person = find(id);
      if (!person || !hasCode(code)) return { error: 'Unknown class' };
      if (n > 0 && !cleanMax(n)) return { error: 'Level must be 1 to 5' };
      const next = n <= 0 ? 0 : (person.levels[code] ?? 0) === n ? n - 1 : n;
      const levels = { ...person.levels };
      if (next > 0) levels[code] = next;
      else delete levels[code];
      patch(id, { levels, rosterKnown: true });
      return { ok: true };
    },
    // Replaces a person's class levels with a roster map, cleaned as on load; their sets stay and the roster becomes known.
    replaceLevels(id, levels) {
      if (!find(id)) return { error: 'Unknown person' };
      patch(id, { levels: cleaned(id, { levels }).levels, rosterKnown: true });
      return { ok: true };
    },
    setBase(id, code) {
      if (!find(id)) return { error: 'Unknown person' };
      if (code !== null && !hasCode(code)) return { error: 'Unknown base class' };
      patch(id, { base: code });
      return { ok: true };
    },
    // Saves the passive set for a base class code; an empty set removes it.
    setSet(id, baseCode, entries) {
      const person = find(id);
      const cls = classes.find((c) => c.code === baseCode);
      if (!person || !cls) return { error: 'Unknown class' };
      const set = normalizeSet(classes, cls.slug, entries);
      const sets = { ...person.sets };
      if (set.length) sets[baseCode] = set;
      else delete sets[baseCode];
      patch(id, { sets });
      return { ok: true };
    },
    // Applies a parseImport build to { id } or to the person named { name }; an unmatched name creates a person. The selection is left alone.
    // The data merge is the own-import rule for everyone: a roster replaces levels, a bare code updates only its class. The
    // person keeps their id and team place. A roster makes the roster known; a created person without one stays unknown.
    applyImport(parsed, target) {
      let person = target.id ? find(target.id) : this.byName(target.name);
      if (!person && target.id) return { error: 'Unknown person' };
      const created = !person;
      if (created) {
        const problem = nameProblem(people, team, null, target.name);
        if (problem) return { error: problem };
        seq += 1;
        person = { id: `p${seq}`, name: target.name, base: null, levels: {}, sets: {}, rosterKnown: parsed.hasRoster };
        people = [...people, person];
      }
      const next = ownImport({ levels: person.levels, sets: person.sets }, parsed);
      const record = cleaned(person.id, { ...person, base: next.base, levels: next.levels, sets: next.sets });
      record.rosterKnown = parsed.hasRoster ? true : person.rosterKnown;
      people = people.map((p) => (p.id === person.id ? record : p));
      save();
      return { ok: true, id: person.id, created };
    },
    // Applies a build to a person in one write.
    saveBuild(id, build) {
      const person = find(id);
      if (!person) return { error: 'Unknown person' };
      const next = saveBuild(classes, person, build);
      if (next === person) return { error: 'Unknown base class' };
      patch(id, { base: next.base, levels: next.levels, sets: next.sets });
      return { ok: true };
    },
    // Saves a build onto { id }, or onto a new person named { create }; returns { ok, id }. A rejected name creates no one.
    saveBuildAs(target, build) {
      let id = target.id;
      if (target.create !== undefined) {
        const added = this.add(target.create);
        if (added.error) return added;
        id = added.id;
      }
      const r = this.saveBuild(id, build);
      return r.error ? r : { ok: true, id };
    },
    get team() {
      return team;
    },
    renameTeam(name) {
      team = { ...team, name: cleanTeamName(name) };
      save();
    },
    // Replaces name and members at once; the members are cleaned as on load.
    replaceTeam(name, members) {
      team = { name: cleanTeamName(name), members: cleanMembers(classes, people, members) };
      save();
    },
    addMember(id, base) {
      const person = find(id);
      if (!person?.name) return { error: 'Name this person before adding them to the team' };
      if (!hasCode(base)) return { error: 'Unknown base class' };
      if (team.members.some((m) => m.id === id)) return { error: 'Already on this team' };
      if (team.members.length >= MAX_MEMBERS) return { error: `A team holds at most ${MAX_MEMBERS} members` };
      team = { ...team, members: [...team.members, { id, base }] };
      save();
      return { ok: true };
    },
    removeMember(id) {
      team = { ...team, members: team.members.filter((m) => m.id !== id) };
      save();
    },
    setMemberBase(id, base) {
      if (!hasCode(base)) return { error: 'Unknown base class' };
      if (!team.members.some((m) => m.id === id)) return { error: 'Not on this team' };
      team = { ...team, members: team.members.map((m) => (m.id === id ? { ...m, base } : m)) };
      save();
      return { ok: true };
    },
  };
}
