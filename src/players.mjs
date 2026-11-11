// Player rules: names, class levels, the own-import merge and the team limits. Stores live in people.mjs.
// A player record is { name, base, levels, sets }: base is a class code, levels maps class code to max level 1-5,
// sets maps class code to a passive set of { code, level } entries.

export const MAX_MEMBERS = 8;
export const MAX_TEAM_NAME = 40;

const NAME_RE = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)?$/;
const lower = (name) => String(name ?? '').toLowerCase();
export const sameName = (a, b) => lower(a) === lower(b);

export const NAME_RULE = 'Use 3 to 20 letters or digits, with at most one underscore that is not at either end';

// 3-20 letters, digits, or one underscore that is not at either end.
export const isValidName = (name) => typeof name === 'string' && name.length >= 3 && name.length <= 20 && NAME_RE.test(name);

export const SELF_NAME = "That's you \u2014 use Import and choose Mine to update your own build";

// Why a player name cannot be used, or null: invalid format first, then the same name as mine.
export function nameProblem(name, me) {
  if (!isValidName(name)) return NAME_RULE;
  if (me && sameName(name, me)) return SELF_NAME;
  return null;
}

// Trimmed and capped at MAX_TEAM_NAME; the cut never leaves trailing whitespace.
export const cleanTeamName = (name) => (typeof name === 'string' ? name.trim().slice(0, MAX_TEAM_NAME).trim() : '');

// The class code a player's card shows: the stored one while owned, else the player's own base, else the first owned class.
export function ownedBase(classes, player, stored) {
  const owns = (code) => (player.levels[code] ?? 0) > 0;
  if (owns(stored)) return stored;
  if (owns(player.base)) return player.base;
  return classes.find((c) => owns(c.code))?.code ?? null;
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
