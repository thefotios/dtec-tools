import { absoluteUrl, pushPath, replacePath, currentPath, teamSegment, addSlot, removeSlot } from './router.mjs';
import { render } from './render.mjs';
import { createStore, decodeRoster } from './owned.mjs';
import { createPassiveStore, toSlots } from './passives.mjs';
import { parseShare, serializeBuildCode, serializeShare, classByCode } from './code.mjs';
import { createPlayersStore, isValidName, mePlayer, playerByName, sameName, ownedBase as ownedBaseCode, NAME_RULE } from './players.mjs';
import { parseTeamLink, serializeTeamLink } from './team.mjs';

const root = document.getElementById('app');
const storage = { getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) };
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
  store: createStore(storage),
  // Rows expanded by hand in edit mode.
  expanded: new Set(),
  // link: an opened team link, null or { name, members, saved }; paste: the library paste form's drafts and feedback.
  team: { link: null, paste: { draft: '', name: '', error: null, message: null, notices: [] } },
  list: { editing: false, filter: '', rosterOpen: false, draft: '', error: null, notices: [], nameEditing: false, nameDraft: null, nameError: null, nameConflict: null },
};

const paint = () => render(root, state, actions);

const classBySlug = (slug) => state.data.classes.find((c) => c.slug === slug) ?? null;

// My record for the selected base, computed fresh from the owned and passives stores and my username.
const myPlayer = () => ({ ...mePlayer(state.data.classes, state.players.me, state.store, state.passives), base: state.build.base?.code ?? null });

// The base a player's card shows: the stored one while owned, else the player's own base, else any owned class.
const ownedBase = (player, stored) => ownedBaseCode(state.data.classes, player, stored);

const meRecord = () => mePlayer(state.data.classes, state.players.me, state.store, state.passives);
const resolvePlayer = (name) => playerByName(state.players, meRecord(), name);
const activeTeam = () => state.players.teams.find((t) => t.id === state.players.active) ?? null;

// '/' when my level for the base is 0 (or no base), else '/<build code>' without roster.
function buildPath() {
  const code = state.build.base ? serializeBuildCode(state.data.classes, myPlayer()) : '';
  return code ? `/${code}` : '/';
}

// Why Copy link and Copy code are unavailable, or null when sharing works.
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

// Loads state from the location. The address bar is never rewritten.
function syncFromLocation() {
  const path = currentPath(window);
  const segment = teamSegment(path);
  if (segment !== null) {
    state.view = 'team';
    state.copy = null;
    if (segment === '' || segment === '/') {
      state.team.link = null;
      state.notices = [];
      return;
    }
    const parsed = parseTeamLink(state.data.classes, segment, window.location.search);
    state.team.link = { name: parsed.name, members: parsed.members, saved: false };
    state.notices = parsed.notices;
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
    if (view === 'team') {
      if (was !== 'team' || state.team.link) {
        state.team.link = null;
        state.notices = [];
        pushPath(window, '/team');
      }
    } else if (was === 'team') {
      if (state.visitor) restoreLast([]);
      state.team.link = null;
      state.notices = [];
      pushPath(window, buildPath());
    }
    paint();
  },
  // Opens the You panel's username input on the Classes page and focuses it.
  openUsername() {
    state.list.nameEditing = true;
    actions.setView('classes');
    focusUsername();
  },
  editUsername() {
    state.list.nameEditing = true;
    paint();
    focusUsername();
  },
  cancelEditUsername() {
    state.list.nameEditing = false;
    state.list.nameDraft = null;
    state.list.nameError = null;
    state.list.nameConflict = null;
    paint();
  },
  pastePlayer(text, nameText) {
    const paste = state.team.paste;
    const fail = (error) => {
      state.team.paste = { draft: text, name: nameText, error, message: null, notices: [] };
      paint();
    };
    const r = parseShare(state.data.classes, text, new URL(document.baseURI).pathname);
    if (r.error) return fail(r.error);
    const name = (r.player.name || nameText).trim();
    if (!name) return fail('Enter a name for this player');
    if (!isValidName(name)) return fail(NAME_RULE);
    if (state.players.me && sameName(name, state.players.me)) return fail("That's you \u2014 edit your build on the Classes page");
    const saved = state.players.upsert({ ...r.player, name }, { merge: isBare(r.player) });
    if (saved.error) return fail(saved.error);
    state.team.paste = { ...paste, draft: '', name: '', error: null, message: `${saved.updated ? 'Updated' : 'Added'} ${name}`, notices: r.notices.map((n) => n.message) };
    paint();
  },
  removePlayer(name) {
    state.players.remove(name);
    paint();
  },
  createTeam() {
    state.players.createTeam(`Team ${state.players.teams.length + 1}`, []);
    paint();
  },
  renameTeam(name) {
    const team = activeTeam();
    if (team) state.players.renameTeam(team.id, name);
    paint();
  },
  deleteTeam() {
    const team = activeTeam();
    if (team) state.players.deleteTeam(team.id);
    paint();
  },
  setActiveTeam(id) {
    state.players.setActive(id);
    state.copy = null;
    paint();
  },
  addMember(name) {
    const team = activeTeam();
    const player = name ? resolvePlayer(name) : null;
    const base = player ? ownedBase(player, player.base) : null;
    if (team && player && base) state.players.addMember(team.id, player.name, base);
    paint();
  },
  removeMember(name) {
    const team = activeTeam();
    if (team) state.players.removeMember(team.id, name);
    paint();
  },
  setMemberBase(name, base) {
    const team = activeTeam();
    if (team) state.players.setMemberBase(team.id, name, base);
    state.copy = null;
    paint();
  },
  // Saves an opened team link: missing players are added from the link, existing ones stay as they are, my own name maps to Me.
  saveTeamLink() {
    const link = state.team.link;
    if (!link || !link.members.length) return;
    const me = state.players.me;
    const members = link.members.map(({ name, player }) => {
      if (me && sameName(name, me)) return { name: me, base: player.base };
      const existing = state.players.get(name);
      if (!existing) state.players.upsert(player);
      return { name: existing?.name ?? name, base: player.base };
    });
    state.players.createTeam(link.name || 'Team', members);
    state.team.link = null;
    state.notices = [];
    state.copy = null;
    pushPath(window, '/team');
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
  mePlayer: meRecord,
  importRoster(text) {
    const r = decodeRoster(state.data.classes, text);
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
  currentUrl() {
    if (state.view !== 'team') return serializeShare(state.data.classes, myPlayer(), document.baseURI);
    if (state.team.link) return window.location.href;
    const team = activeTeam();
    const { path, search } = serializeTeamLink(state.data.classes, team, (name) => {
      const p = resolvePlayer(name);
      const base = p ? ownedBase(p, p.base) : null;
      return base ? { ...p, base } : null;
    });
    return absoluteUrl(document.baseURI, path + search);
  },
  // Why the team Copy link is unavailable, or null.
  teamShareBlock() {
    if (state.team.link) return null;
    const team = activeTeam();
    if (!team) return 'Create a team to share';
    return team.members.length ? null : 'Add players to share';
  },
  currentCode: () => serializeBuildCode(state.data.classes, myPlayer(), { roster: true }),
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
      state.list.nameError = NAME_RULE;
    } else {
      const r = state.players.setMe(name);
      if (r.error) state.list.nameError = r.error;
      else if (r.conflict) state.list.nameConflict = name;
      else {
        state.list.nameDraft = null;
        state.list.nameEditing = false;
      }
    }
    paint();
  },
  claimAsMe() {
    const name = state.list.nameConflict;
    if (name) state.players.claimAsMe(name);
    state.list.nameConflict = null;
    state.list.nameError = null;
    state.list.nameDraft = null;
    state.list.nameEditing = false;
    paint();
  },
  cancelClaim() {
    state.list.nameConflict = null;
    state.list.nameDraft = null;
    state.list.nameEditing = false;
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

function focusUsername() {
  const input = document.querySelector('[data-fk="username"]');
  input?.focus();
  input?.select();
}

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
    state.players = createPlayersStore(storage, data.classes);
    state.passives = createPassiveStore(storage, data.classes);
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
