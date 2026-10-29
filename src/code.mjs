// Build code and share codecs (pure): `c5-sal2sal3sc1[-roster]`, the `s` saved-sets query, and share inputs.
// Passives are plain entries { code, level }; a player is { name, base, levels, sets } with base a class code.
import { encodeRoster, decodeRoster, cleanMax } from './owned.mjs';
import { normalizeSet, MAX_PASSIVES } from './passives.mjs';
import { relativePath } from './router.mjs';

const GROUP = /^[a-z]+\d/;
const ROSTER_END = /[xbcdfg]$/;
const TEAM_LINK_ERROR = 'Open a team link to save its players';

const REASON_TEXT = {
  unknown: 'unknown class',
  level: 'level must be 1 to 3',
  malformed: 'not a class and level',
  extra: 'extra path ignored',
  duplicate: 'duplicate passive ignored',
  self: 'a class cannot be its own passive',
};

function notice(token, reason, detail = REASON_TEXT[reason]) {
  return { token, reason, message: `"${token}": ${detail}` };
}

// Splits a passive run into greedy letters+digit groups; any other maximal chunk is one invalid group.
export function tokenize(run) {
  const s = String(run).toLowerCase();
  const groups = [];
  for (let i = 0; i < s.length; ) {
    const m = GROUP.exec(s.slice(i));
    if (m) {
      const [, token, digit] = /^([a-z]+)(\d)$/.exec(m[0]);
      const level = Number(digit);
      groups.push({ raw: m[0], token, level, valid: level >= 1 && level <= 3 });
      i += m[0].length;
      continue;
    }
    let j = i + 1;
    while (j < s.length && !GROUP.test(s.slice(j))) j++;
    groups.push({ raw: s.slice(i, j), valid: false });
    i = j;
  }
  return groups;
}

// Exact lowercase class code only; null when nothing matches.
export const classByCode = (classes, code) => classes.find((c) => c.code === String(code).toLowerCase()) ?? null;

// Parses a passive run for a base code. Invalid groups, self, and duplicates are dropped with a notice; the first three
// valid groups are kept and returned in canonical order (registry order, then level). Returns { slots, notices }.
function parseRun(classes, baseCode, run) {
  const notices = [];
  const valid = [];
  for (const g of tokenize(run)) {
    if (!g.token) notices.push(notice(g.raw, 'malformed'));
    else if (!g.valid) notices.push(notice(g.raw, 'level'));
    else if (!classByCode(classes, g.token)) notices.push(notice(g.token, 'unknown'));
    else if (g.token === baseCode) notices.push(notice(g.raw, 'self'));
    else if (valid.some((e) => e.code === g.token && e.level === g.level)) notices.push(notice(g.raw, 'duplicate'));
    else valid.push({ code: g.token, level: g.level });
  }
  for (const e of valid.slice(MAX_PASSIVES)) notices.push(notice(`${e.code}${e.level}`, 'extra'));
  const base = classByCode(classes, baseCode);
  return { slots: normalizeSet(classes, base?.slug, valid.slice(0, MAX_PASSIVES)), notices };
}

const runText = (slots) => slots.map((e) => `${e.code}${e.level}`).join('');

// Parses a build code. Returns { base, level, slots, roster, notices }: base is a class code or null (unknown base or level
// drops everything else), roster is the decoded owned map or null. After the base segment, a segment ending in a digit is
// the passive run and one ending in a roster letter is the roster; each is used once, in any order.
export function parseBuildCode(classes, text) {
  const [first = '', ...rest] = String(text).trim().toLowerCase().split('-');
  const failed = (n) => ({ base: null, level: 0, slots: [], roster: null, notices: [n] });
  const m = /^([a-z]+)(\d+)$/.exec(first);
  if (!m || !classByCode(classes, m[1])) return failed(notice(first, 'unknown'));
  const level = Number(m[2]);
  if (!cleanMax(level)) return failed(notice(first, 'level', 'level must be 1 to 5'));
  const out = { base: m[1], level, slots: [], roster: null, notices: [] };
  let sawRun = false;
  let sawRoster = false;
  for (const seg of rest.filter(Boolean)) {
    const isRun = /\d$/.test(seg);
    if (!isRun && !ROSTER_END.test(seg)) {
      out.notices.push(notice(seg, 'malformed'));
    } else if (isRun ? sawRun : sawRoster) {
      out.notices.push(notice(seg, 'extra'));
    } else if (isRun) {
      sawRun = true;
      const r = parseRun(classes, m[1], seg);
      out.slots = r.slots;
      out.notices.push(...r.notices);
    } else {
      sawRoster = true;
      const r = decodeRoster(classes, seg);
      if (r.error) out.notices.push(notice(seg, 'malformed', r.error));
      else {
        out.roster = r.owned;
        out.notices.push(...r.notices.map((message) => ({ token: seg, reason: 'extra', message })));
      }
    }
  }
  return out;
}

// player: { base, levels, sets }. Canonical `<base><level>[-<run>][-<roster>]`; the roster is appended only when
// roster is true and it would not be the empty `X`. Returns '' when the player has no valid base and level.
export function serializeBuildCode(classes, player, { roster = false } = {}) {
  const base = classByCode(classes, player.base);
  const level = player.levels?.[player.base];
  if (!base || !cleanMax(level)) return '';
  const run = runText(normalizeSet(classes, base.slug, player.sets?.[player.base]));
  const owned = roster ? encodeRoster(classes, player.levels) : 'X';
  return [`${base.code}${level}`, run, owned === 'X' ? '' : owned].filter(Boolean).join('-');
}

// Parses the `s` value: dot-separated `<base code>-<run>` items. Returns { sets, notices } with sets keyed by base code.
// An item for baseCode is ignored, since the path carries that base's set; an unknown base, a malformed item, a repeated
// base, or an item whose run yields nothing is dropped.
export function parseSets(classes, text, baseCode = null) {
  const sets = {};
  const notices = [];
  for (const item of String(text ?? '').toLowerCase().split('.').filter(Boolean)) {
    const [code, run, ...more] = item.split('-');
    if (more.length || !run) notices.push(notice(item, 'malformed'));
    else if (!classByCode(classes, code)) notices.push(notice(code, 'unknown'));
    else if (code === baseCode) continue;
    else if (sets[code]) notices.push(notice(item, 'duplicate'));
    else {
      const r = parseRun(classes, code, run);
      notices.push(...r.notices);
      if (r.slots.length) sets[code] = r.slots;
    }
  }
  return { sets, notices };
}

// Saved sets other than the base's, registry order, as `<code>-<run>` items joined by '.'; '' when there are none.
export function serializeSets(classes, player) {
  return classes
    .filter((c) => c.code !== player.base)
    .map((c) => [c.code, runText(normalizeSet(classes, c.slug, player.sets?.[c.code]))])
    .filter(([, run]) => run)
    .map(([code, run]) => `${code}-${run}`)
    .join('.');
}

// Accepts a full URL on any host, a path, or a bare code. Returns { player, hasRoster, hasSets, notices } or { error }.
// The player's base level wins over the roster's; name comes from `u`, trimmed, or is ''.
export function parseShare(classes, text, basePath = '/') {
  const input = String(text ?? '').trim();
  if (!input) return { error: 'Enter a build code or link' };
  let url;
  try {
    url = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? new URL(input) : new URL(input.startsWith('/') ? input : `/${input}`, 'http://share.invalid');
  } catch {
    return { error: 'Not a valid link' };
  }
  const [first, ...extras] = relativePath(url.pathname, basePath).split('/').filter(Boolean);
  if (first === undefined) return { error: 'Enter a build code or link' };
  if (first.toLowerCase() === 'team') return { error: TEAM_LINK_ERROR };
  const build = parseBuildCode(classes, first);
  if (!build.base) return { error: build.notices[0].message };
  const sets = parseSets(classes, url.searchParams.get('s'), build.base);
  const levels = { ...build.roster, [build.base]: build.level };
  if (build.slots.length) sets.sets[build.base] = build.slots;
  return {
    player: { name: (url.searchParams.get('u') ?? '').trim(), base: build.base, levels, sets: sets.sets },
    // hasRoster / hasSets: whether the input carried a roster segment / a non-empty `s`; neither makes it a bare code.
    hasRoster: build.roster !== null,
    hasSets: Boolean((url.searchParams.get('s') ?? '').trim()),
    notices: [...build.notices, ...sets.notices, ...extras.map((e) => notice(e, 'extra'))],
  };
}

// Absolute share URL under baseURI: build code with roster, `u` when the player has a name, `s` when other sets exist.
export function serializeShare(classes, player, baseURI) {
  const url = new URL(serializeBuildCode(classes, player, { roster: true }), baseURI);
  const name = String(player.name ?? '').trim();
  if (name) url.searchParams.set('u', name);
  const sets = serializeSets(classes, player);
  if (sets) url.searchParams.set('s', sets);
  return url.href;
}
