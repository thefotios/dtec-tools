// Players and the team: my username, a library of saved players, and one named team that references players by name.
// A player record is { name, base, levels, sets }: base is a class code, levels maps class code to max level 1-5,
// sets maps class code to a passive set of { code, level } entries.

import { normalizeSet } from './passives.mjs';
import { cleanMax } from './owned.mjs';

const STORAGE_KEY = 'class-combo-viewer:players';
const STORE_VERSION = 1;
export const MAX_MEMBERS = 8;
export const MAX_TEAM_NAME = 40;

const NAME_RE = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)?$/;
const lower = (name) => String(name ?? '').toLowerCase();
export const sameName = (a, b) => lower(a) === lower(b);

export const NAME_RULE = 'Use 3 to 20 letters or digits, with at most one underscore that is not at either end';

// 3-20 letters, digits, or one underscore that is not at either end.
export const isValidName = (name) => typeof name === 'string' && name.length >= 3 && name.length <= 20 && NAME_RE.test(name);

export const SELF_NAME = "That's you \u2014 import your own build on the Builds page";

// Why a player name cannot be used, or null: invalid format first, then the same name as mine.
export function nameProblem(name, me) {
  if (!isValidName(name)) return NAME_RULE;
  if (me && sameName(name, me)) return SELF_NAME;
  return null;
}

// Trimmed and capped at MAX_TEAM_NAME; the cut never leaves trailing whitespace.
export const cleanTeamName = (name) => (typeof name === 'string' ? name.trim().slice(0, MAX_TEAM_NAME).trim() : '');

// Canonical record, or null when the name, base, or base level is unusable.
function normalizeRecord(classes, record) {
  if (!isValidName(record?.name)) return null;
  const known = new Map(classes.map((c) => [c.code, c]));
  const base = record.base;
  if (!known.has(base)) return null;
  const levels = {};
  for (const [code, value] of Object.entries(record.levels ?? {})) {
    if (known.has(code) && cleanMax(value) > 0) levels[code] = value;
  }
  if (!levels[base]) return null;
  const sets = {};
  for (const [code, entries] of Object.entries(record.sets ?? {})) {
    if (!known.has(code)) continue;
    const set = normalizeSet(classes, known.get(code).slug, entries);
    if (set.length) sets[code] = set;
  }
  return { name: record.name, base, levels, sets };
}

// Members keep first occurrence per name, known bases only, at most eight.
function cleanMembers(classes, members) {
  const out = [];
  const seen = new Set();
  for (const m of Array.isArray(members) ? members : []) {
    if (!isValidName(m?.name) || !classes.some((c) => c.code === m.base) || seen.has(lower(m.name))) continue;
    seen.add(lower(m.name));
    out.push({ name: m.name, base: m.base });
    if (out.length === MAX_MEMBERS) break;
  }
  return out;
}

// My own record, computed fresh from the owned and passives stores.
export function mePlayer(classes, name, ownedStore, passiveStore) {
  const levels = { ...ownedStore.owned };
  const lastCode = classes.find((c) => c.slug === passiveStore.last)?.code;
  const base = lastCode ?? classes.find((c) => levels[c.code] > 0)?.code ?? null;
  return { name, base, levels, sets: passiveStore.all() };
}

// The class code a player's card shows: the stored one while owned, else the player's own base, else the first owned class.
export function ownedBase(classes, player, stored) {
  const owns = (code) => (player.levels[code] ?? 0) > 0;
  if (owns(stored)) return stored;
  if (owns(player.base)) return player.base;
  return classes.find((c) => owns(c.code))?.code ?? null;
}

// Me wins over a saved player of the same name.
export function playerByName(store, me, name) {
  if (store.me && sameName(store.me, name)) return me;
  return store.get(name);
}

// Who a parsed link belongs to: 'me' (my name, or a nameless bare code), 'library' (a saved player), else 'visitor'. Me wins over the library.
export function linkOwner(store, player, bare) {
  if (!player.name) return bare ? 'me' : 'visitor';
  if (store.me && sameName(player.name, store.me)) return 'me';
  return store.get(player.name) ? 'library' : 'visitor';
}

const copySet = (set) => set.map((e) => ({ ...e }));
const copySets = (sets) => Object.fromEntries(Object.entries(sets).map(([code, set]) => [code, copySet(set)]));
const hasLevel = (levels) => Object.values(levels).some((n) => n > 0);
const hasSet = (sets) => Object.values(sets).some((set) => set.length > 0);

// Pure: my next { levels, sets, base } after importing `parsed` (a parseImport build) over current { levels, sets }, plus a
// summary of what existing data is replaced. A roster replaces the levels, else only the base level is set. Sets are replaced
// wholesale when the input carries `s`, or is a full link with a roster (the app omits `s` only when there are no other sets);
// otherwise only the base's set is replaced, or removed when the input has no passives.
export function ownImport(current, parsed) {
  const { player, hasRoster, hasSets, isLink } = parsed;
  const base = player.base;
  const levels = hasRoster ? { ...player.levels } : { ...current.levels, [base]: player.levels[base] };
  const replaceAll = hasSets || (isLink && hasRoster);
  const sets = replaceAll ? copySets(player.sets) : copySets(current.sets);
  if (!replaceAll) {
    if (player.sets[base]?.length) sets[base] = copySet(player.sets[base]);
    else delete sets[base];
  }
  const summary = {
    replacesRoster: hasRoster && hasLevel(current.levels),
    replacesAllSets: replaceAll && hasSet(current.sets),
    replacesBaseSet: !replaceAll && (current.sets[base]?.length ?? 0) > 0,
    replacesBaseLevel: !hasRoster && (current.levels[base] ?? 0) > 0 && current.levels[base] !== player.levels[base],
  };
  return { levels, sets, base, summary: { ...summary, replacesExisting: Object.values(summary).some(Boolean) } };
}

const TEAM_ID = 'team';
const emptyTeam = () => ({ name: '', members: [] });

// Stored teams are cleaned field by field; the active one (else the first) becomes the single in-memory team.
function load(storage, classes) {
  const empty = { me: '', players: [], team: emptyTeam() };
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY));
    if (parsed?.v !== STORE_VERSION) return empty;
    const me = isValidName(parsed.me) ? parsed.me : '';
    const players = [];
    for (const raw of Array.isArray(parsed.players) ? parsed.players : []) {
      const record = normalizeRecord(classes, raw);
      if (!record || sameName(record.name, me) || players.some((p) => sameName(p.name, record.name))) continue;
      players.push(record);
    }
    const teams = [];
    for (const raw of Array.isArray(parsed.teams) ? parsed.teams : []) {
      if (typeof raw?.id !== 'string' || !raw.id || teams.some((t) => t.id === raw.id)) continue;
      teams.push({ id: raw.id, name: cleanTeamName(raw.name), members: cleanMembers(classes, raw.members) });
    }
    const kept = teams.find((t) => t.id === parsed.active) ?? teams[0];
    return { me, players, team: kept ? { name: kept.name, members: kept.members } : emptyTeam() };
  } catch {
    return empty;
  }
}

// Reads and writes never throw: a blocked store degrades to in-memory state.
// The persisted shape keeps the v1 layout with exactly one team so earlier versions of the app can still read it.
export function createPlayersStore(storage, classes) {
  let { me, players, team } = load(storage, classes);
  const save = () => {
    try {
      const teams = [{ id: TEAM_ID, ...team }];
      storage.setItem(STORAGE_KEY, JSON.stringify({ v: STORE_VERSION, me, players, teams, active: TEAM_ID }));
    } catch {
      /* in-memory only */
    }
  };
  const hasCode = (code) => classes.some((c) => c.code === code);
  // Renames every membership whose name matches any of `from` to `to`, keeping the first entry when that collides.
  const rekey = (from, to) => {
    const matches = (name) => from.some((f) => sameName(f, name));
    const seen = new Set();
    const members = [];
    for (const m of team.members) {
      const name = matches(m.name) ? to : m.name;
      if (seen.has(lower(name))) continue;
      seen.add(lower(name));
      members.push({ name, base: m.base });
    }
    team = { ...team, members };
  };

  return {
    get me() {
      return me;
    },
    // An empty name clears it; memberships under the old name stay as they are.
    setMe(name) {
      if (name === '') {
        me = '';
        save();
        return { ok: true };
      }
      if (!isValidName(name)) return { error: NAME_RULE };
      if (players.some((p) => sameName(p.name, name))) return { conflict: true };
      if (me) rekey([me], name);
      me = name;
      save();
      return { ok: true };
    },
    // Takes over a saved player's name: removes the player and re-keys its memberships to me.
    claimAsMe(name) {
      const existing = players.find((p) => sameName(p.name, name));
      if (!existing) return this.setMe(name);
      const from = me ? [me, existing.name] : [existing.name];
      players = players.filter((p) => p !== existing);
      rekey(from, existing.name);
      me = existing.name;
      save();
      return { ok: true };
    },
    get players() {
      return [...players].sort((a, b) => (lower(a.name) < lower(b.name) ? -1 : lower(a.name) > lower(b.name) ? 1 : 0));
    },
    get: (name) => players.find((p) => sameName(p.name, name)) ?? null,
    // merge keeps the existing record's other levels and sets and replaces only base, levels[base], and sets[base].
    upsert(record, { merge = false } = {}) {
      const next = normalizeRecord(classes, record);
      if (!next) {
        if (!isValidName(record?.name)) return { error: 'Invalid name' };
        if (!hasCode(record.base)) return { error: 'Unknown base class' };
        return { error: 'Base class needs a level of at least 1' };
      }
      if (me && sameName(me, next.name)) return { error: SELF_NAME };
      const existing = players.find((p) => sameName(p.name, next.name));
      let saved = next;
      if (merge && existing) {
        const sets = { ...existing.sets };
        if (next.sets[next.base]) sets[next.base] = next.sets[next.base];
        else delete sets[next.base];
        saved = { name: next.name, base: next.base, levels: { ...existing.levels, [next.base]: next.levels[next.base] }, sets };
      }
      players = existing ? players.map((p) => (p === existing ? saved : p)) : [...players, saved];
      save();
      return { ok: true, updated: Boolean(existing) };
    },
    // Removing a player drops its team membership.
    remove(name) {
      players = players.filter((p) => !sameName(p.name, name));
      team = { ...team, members: team.members.filter((m) => !sameName(m.name, name)) };
      save();
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
      team = { name: cleanTeamName(name), members: cleanMembers(classes, members) };
      save();
    },
    addMember(name, base) {
      if (!isValidName(name)) return { error: 'Invalid name; set your username first to add yourself' };
      if (!hasCode(base)) return { error: 'Unknown base class' };
      if (team.members.some((m) => sameName(m.name, name))) return { error: 'Already on this team' };
      if (team.members.length >= MAX_MEMBERS) return { error: `A team holds at most ${MAX_MEMBERS} members` };
      team = { ...team, members: [...team.members, { name, base }] };
      save();
      return { ok: true };
    },
    removeMember(name) {
      team = { ...team, members: team.members.filter((m) => !sameName(m.name, name)) };
      save();
    },
    setMemberBase(name, base) {
      if (!hasCode(base)) return { error: 'Unknown base class' };
      if (!team.members.some((m) => sameName(m.name, name))) return { error: 'Not on this team' };
      team = { ...team, members: team.members.map((m) => (sameName(m.name, name) ? { ...m, base } : m)) };
      save();
      return { ok: true };
    },
  };
}
