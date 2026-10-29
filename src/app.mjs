import { absoluteUrl, pushPath, replacePath, currentPath, teamSegment, addSlot, removeSlot, withoutBase } from './router.mjs';
import { render } from './render.mjs';
import { createStore, encodeRoster, decodeRoster } from './owned.mjs';
import { createPassiveStore, toSlots } from './passives.mjs';
import { parseShare, serializeBuildCode, serializeShare, classByCode } from './code.mjs';
import { createPlayersStore, isValidName, mePlayer } from './players.mjs';
import { parseTeam, serializeTeam, createTeamStore, MAX_PLAYERS } from './team.mjs';

const root = document.getElementById('app');
const dataUrl = () => new URL('data/classes.json', document.baseURI).href;

const state = {
  status: 'loading',
  error: null,
  data: null,
  build: { base: null, slots: [] },
  // True while the build shows a link's passives, which are not saved until the user edits passives.
  linkView: false,
  passives: null,
  notices: [],
  passiveFilter: '',
  // True while the loadout panel shows the passive picker.
  loadoutEditing: false,
  // 'copied' (link), 'code-copied', 'failed' (copyText holds the text to select), or null.
  copy: null,
  copyText: '',
  // Another player's opened link: null or { player, bare, nameDraft, saved, savedName, error, notices }. Never saved until the user saves it.
  visitor: null,
  players: null,
  // Local view state; never part of the share URL.
  view: 'classes',
  store: createStore({ getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) }),
  // Rows expanded by hand in edit mode.
  expanded: new Set(),
  team: { builds: [], store: null, owned: [], errors: {}, editing: null, passiveFilter: '' },
  list: { editing: false, filter: '', rosterOpen: false, draft: '', error: null, notices: [], copy: null, nameDraft: null, nameError: null, nameConflict: null },
};

state.team.store = createTeamStore({ getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) });

const paint = () => render(root, state, actions);

const classBySlug = (slug) => state.data.classes.find((c) => c.slug === slug) ?? null;
const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// My record for the selected base, computed fresh from the owned and passives stores and my username.
const myPlayer = () => ({ ...mePlayer(state.data.classes, state.players.me, state.store, state.passives), base: state.build.base?.code ?? null });

// '/' when my level for the base is 0 (or no base), else '/<build code>' without roster.
function buildPath() {
  const code = state.build.base ? serializeBuildCode(state.data.classes, myPlayer()) : '';
  return code ? `/${code}` : '/';
}

// Why Copy my code and Copy link are unavailable, or null when sharing works.
function shareBlock() {
  const { base } = state.build;
  if (!base) return 'Pick a class to share';
  return (state.store.owned[base.code] ?? 0) > 0 ? null : `Unlock ${base.name} to share`;
}

// Shows the last selected base with its saved passives.
function restoreLast(notices) {
  const base = classBySlug(state.passives.last);
  state.visitor = null;
  state.linkView = false;
  state.build = { base, slots: base ? state.passives.get(base.slug) : [] };
  state.notices = notices;
}

// A bare code carries only the base at its level and the base's own passives.
const isBare = (player) => Object.keys(player.levels).every((c) => c === player.base) && Object.keys(player.sets).every((c) => c === player.base);

// Loads state from the location. The address bar is never rewritten for the Classes page; the team view still canonicalizes.
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
  state.view = 'classes';
  state.loadoutEditing = false;
  state.copy = null;
  if (path === '/') return restoreLast([]);
  const r = parseShare(state.data.classes, window.location.pathname + window.location.search, new URL(document.baseURI).pathname);
  if (r.error) return restoreLast([{ token: 'link', reason: 'invalid', message: r.error }]);
  const { player, notices } = r;
  const me = state.players.me;
  const mine = player.name ? Boolean(me) && sameName(player.name, me) : isBare(player);
  if (!mine) {
    state.visitor = { player, bare: isBare(player), nameDraft: player.name, saved: false, savedName: '', error: null, notices };
    state.linkView = false;
    state.build = { base: null, slots: [] };
    state.notices = notices;
    return;
  }
  const base = classByCode(state.data.classes, player.base);
  const slots = toSlots(state.data.classes, player.sets[player.base] ?? []);
  state.visitor = null;
  // A link with passives shows them without saving; a bare base loads my saved set.
  state.linkView = slots.length > 0;
  state.build = { base, slots: state.linkView ? slots : state.passives.get(base.slug) };
  state.passives.setLast(base.slug);
  state.notices = notices;
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

function setTeamBuild(i, build) {
  state.team.builds = state.team.builds.map((b, j) => (j === i ? build : b));
  state.notices = [];
  state.copy = null;
  replacePath(window, teamPath());
  paint();
}

function setSlots(slots) {
  state.build = { ...state.build, slots };
  state.linkView = false;
  if (state.build.base) state.passives.set(state.build.base.slug, slots);
  state.notices = [];
  state.copy = null;
  replacePath(window, buildPath());
  paint();
}

const actions = {
  retry: () => load(),
  // Team has its own URL; leaving it returns to the single-build URL.
  setView(view) {
    const was = state.view;
    state.view = view;
    state.copy = null;
    if (view === 'team' && was !== 'team') pushPath(window, teamPath());
    else if (view !== 'team' && was === 'team') {
      if (state.visitor) restoreLast([]);
      pushPath(window, buildPath());
    }
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
    setTeamBuild(i, { base, slots: withoutBase(cur.slots, base) });
  },
  // Toggles one passive on a card: removes it when present, otherwise adds it in canonical order.
  toggleTeamSlot(i, slug, level) {
    const cls = classBySlug(slug);
    const cur = state.team.builds[i];
    if (!cls) return;
    const has = cur.slots.some((s) => s.cls.slug === slug && s.level === level);
    const slots = has ? removeSlot(cur.slots, cls, level) : addSlot(state.data.classes, cur.slots, cls, level);
    setTeamBuild(i, { ...cur, slots });
  },
  clearTeamSlots: (i) => setTeamBuild(i, { ...state.team.builds[i], slots: [] }),
  setTeamPassiveFilter(value) {
    state.team.passiveFilter = value;
    paint();
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
  setEditing(value) {
    state.list.editing = value;
    state.expanded.clear();
    paint();
  },
  // Outside edit mode a row selects its class; in edit mode it only expands.
  selectClass(slug) {
    if (!state.list.editing) return actions.setBase(slug);
    if (!state.expanded.delete(slug)) state.expanded.add(slug);
    paint();
  },
  setLevel(code, level) {
    state.store.setLevel(code, level);
    paint();
  },
  setListFilter(value) {
    state.list.filter = value;
    paint();
  },
  toggleRoster() {
    state.list.rosterOpen = !state.list.rosterOpen;
    paint();
  },
  jumpToLoadout() {
    document.getElementById('loadout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  setLoadoutEditing(value) {
    state.loadoutEditing = value;
    paint();
  },
  rosterCode: () => encodeRoster(state.data.classes, state.store.owned),
  importRoster(text) {
    const r = decodeRoster(state.data.classes, text);
    state.list.copy = null;
    if (r.error) {
      state.list.error = r.error;
      state.list.notices = [];
      state.list.draft = text;
    } else {
      state.store.replace(r.owned);
      state.list.error = null;
      state.list.notices = r.notices;
      state.list.draft = '';
    }
    paint();
  },
  async copyRoster() {
    try {
      await navigator.clipboard.writeText(actions.rosterCode());
      state.list.copy = 'copied';
    } catch {
      state.list.copy = 'failed';
    }
    paint();
  },
  dismissNotice(i) {
    state.notices = state.notices.filter((_, j) => j !== i);
    paint();
  },
  // Base change pushes a history entry and loads the new base's saved set (empty when none); clearing the base empties the build.
  // Clicking the base already shown from a saved set is a no-op; while a link's passives are shown it reloads the saved set.
  setBase(slug) {
    const base = slug ? classBySlug(slug) : null;
    if (!state.visitor && base && base.slug === state.build.base?.slug && !state.linkView) return paint();
    state.visitor = null;
    state.build = { base, slots: base ? state.passives.get(base.slug) : [] };
    state.linkView = false;
    state.loadoutEditing = false;
    state.passives.setLast(base?.slug ?? null);
    state.notices = [];
    state.copy = null;
    pushPath(window, buildPath());
    paint();
  },
  setPassiveFilter(value) {
    state.passiveFilter = value;
    paint();
  },
  // Passive changes replace the current history entry. Toggling removes a present passive, otherwise adds it in canonical order.
  toggleSlot(slug, level) {
    const cls = classBySlug(slug);
    if (!cls) return;
    const has = state.build.slots.some((s) => s.cls.slug === slug && s.level === level);
    const slots = has ? removeSlot(state.build.slots, cls, level) : addSlot(state.data.classes, state.build.slots, cls, level);
    setSlots(slots);
  },
  clearSlots: () => setSlots([]),
  setUnlockedOnly(value) {
    state.passives.setUnlockedOnly(value);
    paint();
  },
  currentUrl: () => (state.view === 'team' ? absoluteUrl(document.baseURI, teamPath()) : serializeShare(state.data.classes, myPlayer(), document.baseURI)),
  currentCode: () => serializeBuildCode(state.data.classes, myPlayer()),
  shareBlock,
  copyLink: () => copyText(actions.currentUrl(), 'copied'),
  copyCode: () => copyText(actions.currentCode(), 'code-copied'),
  // Saves on change. An invalid name shows an inline error and is not saved; a saved player's name asks for confirmation.
  setMe(text) {
    const name = text.trim();
    state.list.nameDraft = name;
    state.list.nameConflict = null;
    state.list.nameError = null;
    if (name && !isValidName(name)) {
      state.list.nameError = 'Use 3 to 20 letters or digits, with at most one underscore that is not at either end';
    } else {
      const r = state.players.setMe(name);
      if (r.error) state.list.nameError = r.error;
      else if (r.conflict) state.list.nameConflict = name;
      else state.list.nameDraft = null;
    }
    paint();
  },
  claimAsMe() {
    const name = state.list.nameConflict;
    if (name) state.players.claimAsMe(name);
    state.list.nameConflict = null;
    state.list.nameError = null;
    state.list.nameDraft = null;
    paint();
  },
  cancelClaim() {
    state.list.nameConflict = null;
    state.list.nameDraft = null;
    paint();
  },
  setVisitorName(text) {
    if (!state.visitor) return;
    state.visitor.nameDraft = text;
    state.visitor.error = null;
    paint();
  },
  // Saves the opened player to the library; a link without a roster or sets only updates the base and keeps the rest.
  saveVisitor() {
    const v = state.visitor;
    if (!v) return;
    const name = v.nameDraft.trim();
    if (!isValidName(name) || (state.players.me && sameName(name, state.players.me))) return;
    const r = state.players.upsert({ ...v.player, name }, { merge: v.bare });
    if (r.error) v.error = r.error;
    else {
      v.error = null;
      v.saved = true;
      v.savedName = name;
    }
    paint();
  },
};

// Copies text; 'failed' shows a selectable field with the same text.
async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    state.copy = done;
    paint();
    setTimeout(() => {
      if (state.copy === done) {
        state.copy = null;
        paint();
      }
    }, 2000);
  } catch {
    state.copy = 'failed';
    state.copyText = text;
    paint();
  }
}

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
    state.players = createPlayersStore({ getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) }, data.classes);
    state.passives = createPassiveStore({ getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) }, data.classes);
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
