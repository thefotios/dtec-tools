import { parsePath, serializePath, absoluteUrl, pushBuild, replaceBuild, pushPath, replacePath, currentPath, teamSegment, MAX_SLOTS } from './router.mjs';
import { render } from './render.mjs';
import { createStore, encodeRoster, decodeRoster } from './owned.mjs';
import { parseTeam, serializeTeam, createTeamStore, MAX_PLAYERS } from './team.mjs';

const root = document.getElementById('app');
const dataUrl = () => new URL('data/classes.json', document.baseURI).href;

const state = {
  status: 'loading',
  error: null,
  data: null,
  build: { base: null, slots: [] },
  notices: [],
  filter: '',
  copy: null,
  // Local view state; never part of the share URL.
  view: new URLSearchParams(window.location.search).get('view') === 'mine' ? 'mine' : 'build',
  store: createStore({ getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) }),
  team: { builds: [], store: null, owned: [], errors: {}, editing: null },
  mine: { filter: '', ownedOnly: false, draft: '', error: null, notices: [], copy: null },
};

state.team.store = createTeamStore({ getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) });

const paint = () => render(root, state, actions);

// Loads state.build from the location; rewrites a non-canonical URL without adding history.
function syncFromLocation() {
  const path = currentPath(window);
  const segment = teamSegment(path);
  if (segment !== null) {
    const parsed = parseTeam(state.data.classes, segment);
    state.view = 'team';
    state.team.builds = parsed.builds;
    state.team.errors = {};
    state.team.editing = null;
    refreshTeamOwned();
    state.notices = parsed.notices;
    state.copy = null;
    if (serializeTeam(parsed.builds) !== path) replacePath(window, serializeTeam(parsed.builds));
    return;
  }
  if (state.view === 'team') state.view = 'build';
  const parsed = parsePath(state.data.classes, path);
  state.build = { base: parsed.base, slots: parsed.slots };
  state.notices = parsed.notices;
  state.copy = null;
  if (serializePath(parsed) !== path) replaceBuild(window, parsed);
}

// Decoded roster per card position: an owned map, or null when the card has no usable roster.
function refreshTeamOwned() {
  state.team.owned = state.team.builds.map((_, i) => {
    const text = state.team.store.roster(i);
    const r = text ? decodeRoster(state.data.classes, text) : null;
    return r && !r.error && Object.keys(r.owned).length ? r.owned : null;
  });
}

const teamPath = () => serializeTeam(state.team.builds);

const classBySlug = (slug) => state.data.classes.find((c) => c.slug === slug) ?? null;

function setTeamBuild(i, build) {
  state.team.builds = state.team.builds.map((b, j) => (j === i ? build : b));
  state.notices = [];
  state.copy = null;
  replacePath(window, teamPath());
  paint();
}

const actions = {
  retry: () => load(),
  setFilter(value) {
    state.filter = value;
    paint();
  },
  // Team has its own URL; leaving it returns to the single-build URL.
  setView(view) {
    const was = state.view;
    state.view = view;
    state.copy = null;
    if (view === 'team' && was !== 'team') pushPath(window, teamPath());
    else if (view !== 'team' && was === 'team') pushBuild(window, state.build);
    paint();
  },
  addPlayer() {
    if (state.team.builds.length >= MAX_PLAYERS) return;
    state.team.builds = [...state.team.builds, { base: null, slots: [] }];
    state.team.editing = state.team.builds.length - 1;
    refreshTeamOwned();
    state.copy = null;
    pushPath(window, teamPath());
    paint();
  },
  removePlayer(i) {
    state.team.builds = state.team.builds.filter((_, j) => j !== i);
    state.team.store.remove(i);
    state.team.errors = {};
    state.team.editing = null;
    refreshTeamOwned();
    state.copy = null;
    pushPath(window, teamPath());
    paint();
  },
  editPlayer(i) {
    state.team.editing = state.team.editing === i ? null : i;
    paint();
  },
  setTeamBase(i, slug) {
    const base = slug ? classBySlug(slug) : null;
    const cur = state.team.builds[i];
    setTeamBuild(i, { base, slots: base ? cur.slots : [] });
  },
  setTeamSlot(i, index, slug, level) {
    const slots = [...state.team.builds[i].slots];
    const cls = slug ? classBySlug(slug) : null;
    if (!cls) slots.splice(index, 1);
    else if (index < slots.length) slots[index] = { cls, level };
    else if (slots.length < MAX_SLOTS) slots.push({ cls, level });
    setTeamBuild(i, { ...state.team.builds[i], slots });
  },
  // Typing never repaints: the field keeps focus and caret.
  setTeamLabel(i, text) {
    state.team.store.setLabel(i, text);
  },
  importTeamRoster(i, text) {
    if (!text.trim()) {
      state.team.store.setRoster(i, '');
      delete state.team.errors[i];
    } else {
      const r = decodeRoster(state.data.classes, text);
      if (r.error) state.team.errors[i] = { message: r.error, draft: text };
      else {
        state.team.store.setRoster(i, text);
        delete state.team.errors[i];
      }
    }
    refreshTeamOwned();
    paint();
  },
  setOwnedOnly(value) {
    state.store.setOwnedOnly(value);
    paint();
  },
  setLevel(code, level) {
    state.store.setLevel(code, level);
    paint();
  },
  toggleClass(code) {
    state.store.toggleClass(code);
    paint();
  },
  setMineFilter(value) {
    state.mine.filter = value;
    paint();
  },
  setMineOwnedOnly(value) {
    state.mine.ownedOnly = value;
    paint();
  },
  rosterCode: () => encodeRoster(state.data.classes, state.store.owned),
  importRoster(text) {
    const r = decodeRoster(state.data.classes, text);
    state.mine.copy = null;
    if (r.error) {
      state.mine.error = r.error;
      state.mine.notices = [];
      state.mine.draft = text;
    } else {
      state.store.replace(r.owned);
      state.mine.error = null;
      state.mine.notices = r.notices;
      state.mine.draft = '';
    }
    paint();
  },
  async copyRoster() {
    try {
      await navigator.clipboard.writeText(actions.rosterCode());
      state.mine.copy = 'copied';
    } catch {
      state.mine.copy = 'failed';
    }
    paint();
  },
  dismissNotice(i) {
    state.notices = state.notices.filter((_, j) => j !== i);
    paint();
  },
  // Base change pushes a history entry; clearing the base also drops the passives.
  setBase(slug) {
    const base = slug ? classBySlug(slug) : null;
    state.build = { base, slots: base ? state.build.slots : [] };
    state.notices = [];
    state.copy = null;
    pushBuild(window, state.build);
    paint();
  },
  // Slot change replaces the current entry. Picking a class selects level 1; null removes the slot.
  setSlot(index, slug, level) {
    const slots = [...state.build.slots];
    const cls = slug ? classBySlug(slug) : null;
    if (!cls) slots.splice(index, 1);
    else if (index < slots.length) slots[index] = { cls, level };
    else if (slots.length < MAX_SLOTS) slots.push({ cls, level });
    state.build = { ...state.build, slots };
    state.notices = [];
    state.copy = null;
    replaceBuild(window, state.build);
    paint();
  },
  clearSlot: (index) => actions.setSlot(index, null, 1),
  currentUrl: () => absoluteUrl(document.baseURI, state.view === 'team' ? teamPath() : serializePath(state.build)),
  async copyLink() {
    try {
      await navigator.clipboard.writeText(actions.currentUrl());
      state.copy = 'copied';
      paint();
      setTimeout(() => {
        if (state.copy === 'copied') {
          state.copy = null;
          paint();
        }
      }, 2000);
    } catch {
      state.copy = 'failed';
      paint();
    }
  },
};

async function load() {
  state.status = 'loading';
  paint();
  const url = dataUrl();
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.classes) || !data.tiers) throw new Error('unexpected data shape');
    state.data = data;
    state.status = 'ready';
    syncFromLocation();
  } catch (e) {
    state.status = 'error';
    state.error = { url, message: e.message };
  }
  paint();
}

window.addEventListener('popstate', () => {
  if (state.status !== 'ready') return;
  syncFromLocation();
  paint();
});

load();
