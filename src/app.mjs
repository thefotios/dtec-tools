import { absoluteUrl, pushPath, replacePath, currentPath, teamSegment, addSlot, removeSlot } from './router.mjs';
import { render } from './render.mjs';
import { createStore, decodeRoster } from './owned.mjs';
import { createPassiveStore, toSlots, fromSlots } from './passives.mjs';
import { parseShare, serializeBuildCode, serializeShare, classByCode } from './code.mjs';
import { createPlayersStore, nameProblem, mePlayer, playerByName, sameName, ownedBase as ownedBaseCode } from './players.mjs';
import { parseTeamLink, serializeTeamLink } from './team.mjs';

const root = document.getElementById('app');
const storage = { getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) };
const dataUrl = () => new URL('data/classes.json', document.baseURI).href;
const effectsUrl = () => new URL('data/effects.json', document.baseURI).href;

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
  // One-shot: the next paint selects the clipboard fallback field, then clears it.
  copyFocus: false,
  // Another player's opened link: null or { player, bare, nameDraft, saved, savedName, error, notices }. Never saved until the user saves it.
  visitor: null,
  players: null,
  // Local view state; never part of the share URL.
  view: 'classes',
  store: createStore(storage),
  // Rows expanded by hand in edit mode.
  expanded: new Set(),
  // Team cards whose "Own effects" disclosure is open (member names); transient, not persisted.
  openEffects: new Set(),
  // link: an opened team link, null or { name, members, saved }; paste: the library paste form's drafts and feedback.
  team: { link: null, paste: { draft: '', name: '', error: null, message: null, notices: [] } },
  list: { editing: false, filter: '', rosterOpen: false, draft: '', error: null, notices: [], nameEditing: false, nameDraft: null, nameError: null, nameConflict: null },
};

const paint = () => render(root, state, actions);

const classBySlug = (slug) => state.data.classes.find((c) => c.slug === slug) ?? null;

const meRecord = () => mePlayer(state.data.classes, state.players.me, state.store, state.passives);

// My record for the selected base, computed fresh from the owned and passives stores and my username.
// While a link's passives are shown, they stand in for the saved set of that base so copies match the screen.
function myPlayer() {
  const base = state.build.base;
  const player = { ...meRecord(), base: base?.code ?? null };
  if (state.linkView && base) {
    const sets = { ...player.sets };
    if (state.build.slots.length) sets[base.code] = fromSlots(state.build.slots);
    else delete sets[base.code];
    player.sets = sets;
  }
  return player;
}

// The base a player's card shows: the stored one while owned, else the player's own base, else any owned class.
const ownedBase = (player, stored) => ownedBaseCode(state.data.classes, player, stored);

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

// The saved team an opened team link duplicates: same name and same member names, ignoring case and order.
function savedTeamFor(link) {
  if (!link?.members.length) return null;
  const key = (names) => names.map((n) => n.toLowerCase()).sort().join('~');
  const wanted = key(link.members.map((m) => m.name));
  return state.players.teams.find((t) => t.name.toLowerCase() === link.name.toLowerCase() && key(t.members.map((m) => m.name)) === wanted) ?? null;
}

// Loads state from the location. The address bar is never rewritten.
function syncFromLocation() {
  const path = currentPath(window);
  const segment = teamSegment(path);
  if (path === '/help' || path === '/help/') {
    state.view = 'help';
    state.copy = null;
    state.notices = [];
    return;
  }
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
  // A bare code has neither a roster segment nor `s`; without a name it is my own build.
  const bare = !r.hasRoster && !r.hasSets;
  const mine = player.name ? Boolean(me) && sameName(player.name, me) : bare;
  if (!mine) {
    state.visitor = { player, bare, nameDraft: player.name, saved: false, savedName: '', error: null, notices };
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
  setEffectsOpen(key, open) {
    if (open) state.openEffects.add(key);
    else state.openEffects.delete(key);
  },
  // Team has its own URL; leaving it returns to the single-build URL.
  setView(view) {
    const was = state.view;
    state.view = view;
    state.copy = null;
    if (view === 'help') {
      if (was !== 'help') pushPath(window, '/help');
    } else if (view === 'team') {
      if (was !== 'team' || state.team.link) {
        state.team.link = null;
        state.notices = [];
        pushPath(window, '/team');
      }
    } else if (was === 'team' || was === 'help') {
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
    const name = (nameText.trim() || r.player.name).trim();
    if (!name) return fail('Enter a name for this player');
    const problem = nameProblem(name, state.players.me);
    if (problem) return fail(problem);
    const saved = state.players.upsert({ ...r.player, name }, { merge: !r.hasRoster && !r.hasSets });
    if (saved.error) return fail(saved.error);
    state.team.paste = { ...paste, draft: '', name: '', error: null, message: `${saved.updated ? 'Updated' : 'Added'} ${name}`, notices: r.notices.map((n) => n.message) };
    paint();
  },
  // Draft setters keep typed text in state without painting, so a repaint from any source cannot drop it.
  setPasteDraft(text) {
    state.team.paste.draft = text;
  },
  setPasteName(text) {
    state.team.paste.name = text;
  },
  setRosterDraft(text) {
    state.list.draft = text;
  },
  setNameDraft(text) {
    state.list.nameDraft = text;
  },
  setTeamNameDraft(name) {
    const team = activeTeam();
    if (team) state.players.renameTeam(team.id, name);
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
  // The saved team an opened team link duplicates, or null.
  linkSavedTeam: () => savedTeamFor(state.team.link),
  openTeam(id) {
    state.players.setActive(id);
    state.team.link = null;
    state.notices = [];
    state.copy = null;
    pushPath(window, '/team');
    paint();
  },
  // Saves an opened team link: missing players are added from the link, existing ones stay as they are, my own name maps to Me.
  saveTeamLink() {
    const link = state.team.link;
    if (!link || !link.members.length || savedTeamFor(link)) return;
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
    replacePath(window, '/team');
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
    const problem = name ? nameProblem(name, '') : null;
    if (problem) {
      state.list.nameError = problem;
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
    if (nameProblem(name, state.players.me)) return;
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

let copyTimer = null;

// Copies text; 'failed' shows a selectable field with the same text.
async function copyText(text, done) {
  clearTimeout(copyTimer);
  try {
    await navigator.clipboard.writeText(text);
    state.copy = done;
    paint();
    copyTimer = setTimeout(() => {
      if (state.copy === done) {
        state.copy = null;
        paint();
      }
    }, 2000);
  } catch {
    state.copy = 'failed';
    state.copyText = text;
    state.copyFocus = true;
    paint();
  }
}

async function load() {
  state.status = 'loading';
  paint();
  const url = dataUrl();
  try {
    const [res, effectsRes] = await Promise.all([fetch(url, { cache: 'no-cache' }), fetch(effectsUrl(), { cache: 'no-cache' })]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!effectsRes.ok) throw new Error(`effects.json: HTTP ${effectsRes.status}`);
    const data = await res.json();
    const effects = await effectsRes.json();
    if (!Array.isArray(data.classes) || !data.tiers) throw new Error('unexpected data shape');
    if (!effects.categories || !effects.stats || !effects.whens || !effects.questions) throw new Error('unexpected effects shape');
    data.effects = effects;
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

// Another tab wrote one of the stores: reload it from storage so this tab's next write does not overwrite that change.
window.addEventListener('storage', (e) => {
  if (state.status !== 'ready') return;
  const key = e.key ?? '';
  const all = e.key === null;
  const hit = (suffix) => all || key === `class-combo-viewer:${suffix}`;
  if (!hit('owned') && !hit('passives') && !hit('players')) return;
  const classes = state.data.classes;
  if (hit('owned')) state.store = createStore(storage);
  if (hit('passives')) state.passives = createPassiveStore(storage, classes);
  if (hit('players')) state.players = createPlayersStore(storage, classes);
  if (state.build.base && !state.linkView) state.build = { ...state.build, slots: state.passives.get(state.build.base.slug) };
  paint();
});

window.addEventListener('popstate', () => {
  if (state.status !== 'ready') return;
  syncFromLocation();
  paint();
});

load();
