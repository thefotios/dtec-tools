import { parseBuild, serializeBuild } from './router.mjs';

export const MAX_PLAYERS = 8;
const BLANK = '_';

function teamNotice(token, reason, message) {
  return { token, reason, message };
}

// Parses the part of a team path after "/team", e.g. "/scout.sal2sal3~miner.rec1". Pure.
// Each build is "<base token>.<passive run>" (or just "<base token>"); "_" is a card with no class yet.
// Returns { builds: [{ base, slots }], notices }.
export function parseTeam(classes, segment) {
  const [list = '', ...extras] = String(segment).split('/').filter(Boolean);
  const notices = [];
  const builds = [];
  if (list) {
    list.split('~').forEach((raw, i) => {
      if (raw === BLANK || raw === '') return void builds.push({ base: null, slots: [] });
      const dot = raw.indexOf('.');
      const baseToken = dot < 0 ? raw : raw.slice(0, dot);
      const run = dot < 0 ? '' : raw.slice(dot + 1);
      const parsed = parseBuild(classes, baseToken, run);
      if (!parsed.base) {
        const why = parsed.notices[0]?.message ?? 'not a class';
        notices.push(teamNotice(raw, 'build', `Player ${i + 1} "${raw}" dropped: ${why}`));
        return;
      }
      builds.push({ base: parsed.base, slots: parsed.slots });
      for (const n of parsed.notices) notices.push(teamNotice(n.token, n.reason, `Player ${i + 1}: ${n.message}`));
    });
  }
  if (builds.length > MAX_PLAYERS) {
    notices.push(teamNotice(String(builds.length), 'extra', `Only ${MAX_PLAYERS} players fit; ignored ${builds.length - MAX_PLAYERS}`));
    builds.length = MAX_PLAYERS;
  }
  if (extras.length) notices.push(teamNotice(extras[0], 'extra', 'extra path ignored'));
  return { builds, notices };
}

// Canonical base-relative team path: "/team" or "/team/scout.sal2~miner".
export function serializeTeam(builds) {
  if (!builds.length) return '/team';
  const parts = builds.map((b) => {
    const { base, run } = serializeBuild(b);
    if (!base) return BLANK;
    return run ? `${base}.${run}` : base;
  });
  return `/team/${parts.join('~')}`;
}

const STORAGE_KEY = 'class-combo-viewer:team';
const STORE_VERSION = 1;

function loadCards(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY));
    if (parsed?.v !== STORE_VERSION || !Array.isArray(parsed.cards)) return [];
    return parsed.cards.slice(0, MAX_PLAYERS).map((c) => ({
      label: typeof c?.label === 'string' ? c.label : '',
      roster: typeof c?.roster === 'string' ? c.roster : '',
    }));
  } catch {
    return [];
  }
}

// Local labels and roster codes keyed by card position; the URL carries builds only.
// Reads and writes never throw: a blocked store degrades to in-memory state.
export function createTeamStore(storage) {
  let cards = loadCards(storage);
  const save = () => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ v: STORE_VERSION, cards }));
    } catch {
      /* in-memory only */
    }
  };
  const card = (i) => cards[i] ?? { label: '', roster: '' };
  const update = (i, patch) => {
    while (cards.length <= i) cards.push({ label: '', roster: '' });
    cards[i] = { ...cards[i], ...patch };
    save();
  };
  return {
    label: (i) => card(i).label,
    roster: (i) => card(i).roster,
    setLabel: (i, label) => update(i, { label }),
    setRoster: (i, roster) => update(i, { roster }),
    remove(i) {
      cards = cards.filter((_, j) => j !== i);
      save();
    },
  };
}
