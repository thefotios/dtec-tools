// Players and teams: my username, a library of saved players, and named teams that reference players by name.
// A player record is { name, base, levels, sets }: base is a class code, levels maps class code to max level 1-5,
// sets maps class code to a passive set of { code, level } entries.

import { normalizeSet } from './passives.mjs';

const STORAGE_KEY = 'class-combo-viewer:players';
const STORE_VERSION = 1;
export const MAX_MEMBERS = 8;
export const MAX_TEAM_NAME = 40;

const NAME_RE = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)?$/;
const lower = (name) => String(name ?? '').toLowerCase();
const sameName = (a, b) => lower(a) === lower(b);

// 3-20 letters, digits, or one underscore that is not at either end.
export const isValidName = (name) => typeof name === 'string' && name.length >= 3 && name.length <= 20 && NAME_RE.test(name);

const cleanTeamName = (name) => (typeof name === 'string' ? name.trim().slice(0, MAX_TEAM_NAME) : '');

// Canonical record, or null when the name, base, or base level is unusable.
function normalizeRecord(classes, record) {
  if (!isValidName(record?.name)) return null;
  const known = new Map(classes.map((c) => [c.code, c]));
  const base = record.base;
  if (!known.has(base)) return null;
  const levels = {};
  for (const [code, value] of Object.entries(record.levels ?? {})) {
    if (known.has(code) && Number.isInteger(value) && value >= 1 && value <= 5) levels[code] = value;
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

// Me wins over a saved player of the same name.
export function playerByName(store, me, name) {
  if (store.me && sameName(store.me, name)) return me;
  return store.get(name);
}

function load(storage, classes) {
  const empty = { me: '', players: [], teams: [], active: null };
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY));
    if (parsed?.v !== STORE_VERSION || typeof parsed !== 'object') return empty;
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
    const active = teams.some((t) => t.id === parsed.active) ? parsed.active : null;
    return { me, players, teams, active };
  } catch {
    return empty;
  }
}

const defaultNewId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Reads and writes never throw: a blocked store degrades to in-memory state.
export function createPlayersStore(storage, classes, { newId = defaultNewId } = {}) {
  let { me, players, teams, active } = load(storage, classes);
  const save = () => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ v: STORE_VERSION, me, players, teams, active }));
    } catch {
      /* in-memory only */
    }
  };
  const findTeam = (id) => teams.find((t) => t.id === id);
  const updateTeam = (id, fn) => {
    teams = teams.map((t) => (t.id === id ? fn(t) : t));
    save();
  };
  const hasCode = (code) => classes.some((c) => c.code === code);
  // Renames every membership whose name matches any of `from` to `to`, keeping the first entry when that collides within a team.
  const rekey = (from, to) => {
    const matches = (name) => from.some((f) => sameName(f, name));
    teams = teams.map((t) => {
      const seen = new Set();
      const members = [];
      for (const m of t.members) {
        const name = matches(m.name) ? to : m.name;
        if (seen.has(lower(name))) continue;
        seen.add(lower(name));
        members.push({ name, base: m.base });
      }
      return { ...t, members };
    });
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
      if (!isValidName(name)) return { error: 'Username must be 3-20 letters, digits, or one underscore not at either end' };
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
      if (me && sameName(me, next.name)) return { error: 'That is your own username' };
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
    // Removing a player drops every membership of that name.
    remove(name) {
      players = players.filter((p) => !sameName(p.name, name));
      teams = teams.map((t) => ({ ...t, members: t.members.filter((m) => !sameName(m.name, name)) }));
      save();
    },
    get teams() {
      return teams;
    },
    get active() {
      return active;
    },
    setActive(id) {
      active = findTeam(id) ? id : null;
      save();
    },
    // The new team always becomes active, so the first team and every freshly created team open in the UI.
    createTeam(name, members = []) {
      let id = String(newId());
      while (findTeam(id)) id = String(newId());
      teams = [...teams, { id, name: cleanTeamName(name), members: cleanMembers(classes, members) }];
      active = id;
      save();
      return id;
    },
    renameTeam(id, name) {
      if (findTeam(id)) updateTeam(id, (t) => ({ ...t, name: cleanTeamName(name) }));
    },
    // Deleting the active team activates the first remaining team.
    deleteTeam(id) {
      if (!findTeam(id)) return;
      teams = teams.filter((t) => t.id !== id);
      if (active === id) active = teams[0]?.id ?? null;
      save();
    },
    addMember(id, name, base) {
      const team = findTeam(id);
      if (!team) return { error: 'Unknown team' };
      if (!isValidName(name)) return { error: 'Invalid name; set your username first to add yourself' };
      if (!hasCode(base)) return { error: 'Unknown base class' };
      if (team.members.some((m) => sameName(m.name, name))) return { error: 'Already on this team' };
      if (team.members.length >= MAX_MEMBERS) return { error: `A team holds at most ${MAX_MEMBERS} members` };
      updateTeam(id, (t) => ({ ...t, members: [...t.members, { name, base }] }));
      return { ok: true };
    },
    removeMember(id, name) {
      if (findTeam(id)) updateTeam(id, (t) => ({ ...t, members: t.members.filter((m) => !sameName(m.name, name)) }));
    },
    setMemberBase(id, name, base) {
      const team = findTeam(id);
      if (!team) return { error: 'Unknown team' };
      if (!hasCode(base)) return { error: 'Unknown base class' };
      if (!team.members.some((m) => sameName(m.name, name))) return { error: 'Not on this team' };
      updateTeam(id, (t) => ({ ...t, members: t.members.map((m) => (sameName(m.name, name) ? { ...m, base } : m)) }));
      return { ok: true };
    },
  };
}
