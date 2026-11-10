import { absoluteUrl, relativePath, pushPath, replacePath, currentPath, teamSegment, addSlot, removeSlot } from './router.mjs';
import { render } from './render.mjs';
import { createStore } from './owned.mjs';
import { createPassiveStore, savedSlots, fromSlots, MAX_PASSIVES } from './passives.mjs';
import { parseShare, parseImport, serializeBuildCode, serializeShare, classByCode } from './code.mjs';
import { createPlayersStore, nameProblem, isValidName, mePlayer, playerByName, sameName, linkOwner, ownImport, ownedBase as ownedBaseCode } from './players.mjs';
import { parseTeamLink, serializeTeamLink, sameTeam } from './team.mjs';

const root = document.getElementById('app');
const storage = { getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) };
const dataUrl = () => new URL('data/classes.json', document.baseURI).href;
const effectsUrl = () => new URL('data/effects.json', document.baseURI).href;

function freshImport() {
  return { draft: '', error: null, message: null, savedName: '', notices: [], pending: null };
}

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
  // The player shown on the Builds page, null for me: { player, source, link }. source is 'library' (a saved player) or 'link' (an opened link, unsaved).
  // link carries the banner fields { incoming, bare, nameDraft, saved, savedName, error } for an unsaved link or one that differs from the saved record; incoming is the link's record. Never saved until the user saves it.
  viewing: null,
  // In-memory passive experiments for a viewed player: expKey(player, base code) -> slots. Never persisted and never written to the stores.
  experiments: new Map(),
  players: null,
  // Local view state; never part of the share URL.
  view: 'builds',
  store: createStore(storage),
  // Rows expanded by hand in edit mode.
  expanded: new Set(),
  // link: an opened team link, null or { name, members, confirming }; confirming shows the "Replace my team" prompt.
  team: { link: null },
  // import: the import box. pending is null, { kind: 'confirm', parsed, summary } or { kind: 'whose', parsed, nameDraft, error }.
  list: { editing: false, filter: '', import: freshImport(), nameEditing: false, nameDraft: null, nameError: null, nameConflict: null },
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

// The viewed player's share link as a base-relative path, with the selected base.
function viewPath() {
  const href = serializeShare(state.data.classes, sharedRecord(), document.baseURI);
  const url = new URL(href);
  return relativePath(url.pathname, new URL(document.baseURI).pathname) + url.search;
}

// The record Copy link and Copy code share: mine, or the viewed player's saved record. Experiments never reach it.
const sharedRecord = () => (state.viewing ? { ...state.viewing.player, base: state.build.base?.code ?? state.viewing.player.base } : myPlayer());

// '/' when my level for the base is 0 (or no base), else '/<build code>' without roster; the viewed player's share link while viewing.
function buildPath() {
  if (state.viewing) return viewPath();
  const code = state.build.base ? serializeBuildCode(state.data.classes, myPlayer()) : '';
  return code ? `/${code}` : '/';
}

// Why Copy link and Copy code are unavailable, or null when sharing works.
function shareBlock() {
  const { base } = state.build;
  if (!base) return 'Pick a class to share';
  return (sharedRecord().levels[base.code] ?? 0) > 0 ? null : `Unlock ${base.name} to share`;
}

// Shows the last selected base with its saved passives.
function restoreLast(notices) {
  const base = classBySlug(state.passives.last);
  state.viewing = null;
  state.linkView = false;
  state.build = { base, slots: base ? state.passives.get(base.slug) : [] };
  state.notices = notices;
}

// Keyed by lower-cased name and base code; a nameless link is keyed by its canonical code so two links never share one.
const expPrefix = (player) => `${player.name ? player.name.toLowerCase() : `~${serializeBuildCode(state.data.classes, player, { roster: true })}`}\n`;
const expKey = (player, code) => `${expPrefix(player)}${code}`;
const savedBaseSlots = (player, base) => (base ? savedSlots(state.data.classes, player, base.code) : []);
// The experiment for the base when there is one, else the player's saved set.
const viewedSlots = (player, base) => (base ? state.experiments.get(expKey(player, base.code)) ?? savedBaseSlots(player, base) : []);

function dropExperiments(player) {
  const prefix = expPrefix(player);
  for (const k of [...state.experiments.keys()]) if (k.startsWith(prefix)) state.experiments.delete(k);
}

// Shows a player on the Builds page with the saved set of the base; edit and import state is reset so the view stays read-only.
function showPlayer(player, source, link, baseCode, hasRoster = false) {
  state.viewing = { player, source, link, hasRoster };
  state.linkView = false;
  state.list.editing = false;
  state.loadoutEditing = false;
  const base = classByCode(state.data.classes, baseCode);
  state.build = { base, slots: viewedSlots(player, base) };
}

const bannerFor = (incoming, bare, name) => ({ incoming, bare, nameDraft: name, saved: false, savedName: '', error: null });

// Whether saving the link would change the stored record, judged on the canonical share link of the result.
function linkDiffers(stored, incoming, bare) {
  const scratch = createPlayersStore({ getItem: () => null, setItem: () => {} }, state.data.classes);
  scratch.upsert(stored);
  scratch.upsert(incoming, { merge: bare });
  const share = (p) => serializeShare(state.data.classes, { ...p, name: stored.name, base: incoming.base }, document.baseURI);
  return share(scratch.get(stored.name)) !== share(stored);
}

// Loads state from the location. A known player's link is rewritten to their canonical share link unless it differs from the saved record; other links leave the address bar alone.
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
    state.team.link = { name: parsed.name, members: parsed.members, confirming: false };
    state.notices = parsed.notices;
    return;
  }
  state.view = 'builds';
  state.loadoutEditing = false;
  state.copy = null;
  if (path === '/') return restoreLast([]);
  const r = parseShare(state.data.classes, window.location.pathname + window.location.search, new URL(document.baseURI).pathname);
  if (r.error) return restoreLast([{ token: 'link', reason: 'invalid', message: r.error }]);
  const { player, notices } = r;
  // A bare code has neither a roster segment nor `s`; without a name it is my own build.
  const bare = !r.hasRoster && !r.hasSets;
  const owner = linkOwner(state.players, player, bare);
  if (owner === 'visitor') {
    showPlayer(player, 'link', bannerFor(player, bare, player.name), ownedBase(player, player.base), r.hasRoster);
    state.notices = notices;
    return;
  }
  if (owner === 'library') {
    const stored = state.players.get(player.name);
    const baseCode = ownedBase(stored, player.base);
    const differs = linkDiffers(stored, player, bare);
    showPlayer(stored, 'library', differs ? bannerFor(player, bare, stored.name) : null, baseCode);
    if (!differs) replacePath(window, viewPath());
    state.notices = notices;
    return;
  }
  const base = classByCode(state.data.classes, player.base);
  const slots = savedSlots(state.data.classes, player, player.base);
  state.viewing = null;
  // A link with passives shows them without saving; a bare base loads my saved set.
  state.linkView = slots.length > 0;
  state.build = { base, slots: state.linkView ? slots : state.passives.get(base.slug) };
  state.passives.setLast(base.slug);
  state.notices = notices;
}

function setSlots(slots) {
  state.build = { ...state.build, slots };
  state.notices = [];
  state.copy = null;
  // A viewed player's change is an experiment: kept in memory, with no URL or store write.
  if (state.viewing) {
    const { player } = state.viewing;
    const { base } = state.build;
    if (base) state.experiments.set(expKey(player, base.code), slots);
    return paint();
  }
  state.linkView = false;
  if (state.build.base) state.passives.set(state.build.base.slug, slots);
  replacePath(window, buildPath());
  paint();
}

// My current levels and saved sets, the input ownImport merges a pasted build into.
const currentOwn = () => ({ levels: state.store.owned, sets: state.passives.all() });

// What importing `parsed` over my own data would replace; a roster code replaces only my classes.
function importSummary(parsed) {
  if (parsed.kind === 'roster') {
    const replacesRoster = state.store.hasAny();
    return { replacesRoster, replacesExisting: replacesRoster };
  }
  return ownImport(currentOwn(), parsed).summary;
}

const focusFk = (key) => document.querySelector(`[data-fk="${key}"]`)?.focus({ preventScroll: true });

const noticeTexts = (notices) => notices.map((n) => n.message);

// Applies an own import: one write per store, then my view shows the imported base with its saved set.
function applyOwnBuild(parsed) {
  const next = ownImport(currentOwn(), parsed);
  state.store.replace(next.levels);
  state.passives.replaceAll(next.sets);
  const base = classByCode(state.data.classes, next.base);
  const moved = Boolean(state.viewing) || base.slug !== state.build.base?.slug;
  state.viewing = null;
  state.linkView = false;
  state.list.editing = false;
  state.loadoutEditing = false;
  state.expanded.clear();
  state.build = { base, slots: state.passives.get(base.slug) };
  state.passives.setLast(base.slug);
  state.notices = [];
  state.copy = null;
  (moved ? pushPath : replacePath)(window, buildPath());
  state.list.import = { ...freshImport(), message: 'Updated your build', notices: noticeTexts(parsed.notices) };
}

// A bare roster code replaces only my owned classes; a viewed player's view returns to me.
function applyOwnRoster(parsed) {
  state.store.replace(parsed.owned);
  state.linkView = false;
  state.list.editing = false;
  state.expanded.clear();
  if (state.viewing) restoreLast([]);
  state.copy = null;
  replacePath(window, buildPath());
  state.list.import = { ...freshImport(), message: 'Updated your classes', notices: noticeTexts(parsed.notices) };
}

const applyOwn = (parsed) => (parsed.kind === 'roster' ? applyOwnRoster(parsed) : applyOwnBuild(parsed));

// Saves a pasted build to the library under `name`; returns an error text or null. A code with neither roster nor sets only updates the base.
function saveImported(parsed, name) {
  const saved = state.players.upsert({ ...parsed.player, name }, { merge: !parsed.hasRoster && !parsed.hasSets });
  if (saved.error) return saved.error;
  state.list.import = { ...freshImport(), message: `${saved.updated ? 'Updated' : 'Added'} ${name}`, savedName: name, notices: noticeTexts(parsed.notices) };
  if (state.viewing) refreshViewing();
  return null;
}

const actions = {
  retry: () => load(),
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
      if (state.viewing) restoreLast([]);
      state.team.link = null;
      state.notices = [];
      pushPath(window, buildPath());
    }
    paint();
  },
  // Opens the You panel's username input on the Builds page and focuses it.
  openUsername() {
    state.list.nameEditing = true;
    actions.setView('builds');
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
  // Draft setters keep typed text in state without painting; a draft change while a prompt is open dismisses the prompt, which must never act on other text than it shows.
  setImportDraft(text) {
    const imp = state.list.import;
    imp.draft = text;
    if (imp.pending) {
      imp.pending = null;
      paint();
    }
  },
  setImportName(text) {
    const p = state.list.import.pending;
    if (p?.kind !== 'whose') return;
    p.nameDraft = text;
    if (p.error) {
      p.error = null;
      paint();
    }
  },
  importSummary,
  // Classifies the pasted text and routes it by owner: my own build, the library, a team link, or the whose-prompt.
  importText(text) {
    const r = parseImport(state.data.classes, text, new URL(document.baseURI).pathname);
    const imp = state.list.import;
    imp.draft = text;
    imp.message = null;
    imp.savedName = '';
    imp.notices = [];
    imp.pending = null;
    imp.error = null;
    if (r.error) {
      imp.error = r.error;
      return paint();
    }
    if (r.kind === 'team') {
      state.list.import = freshImport();
      pushPath(window, r.path);
      syncFromLocation();
      return paint();
    }
    const me = state.players.me;
    const name = r.kind === 'build' ? r.player.name : '';
    const mine = r.kind === 'roster' || (name && me && sameName(name, me));
    if (mine) {
      const summary = importSummary(r);
      if (summary.replacesExisting) {
        imp.pending = { kind: 'confirm', parsed: r, summary };
        paint();
        return focusFk('import-yes');
      }
      applyOwn(r);
      return paint();
    }
    if (name && me && !nameProblem(name, me)) {
      imp.error = saveImported(r, name);
      return paint();
    }
    imp.pending = { kind: 'whose', parsed: r, nameDraft: name, error: null };
    paint();
    focusFk('import-mine');
  },
  // Applies the pending own update against my current data, so edits made while the prompt was open are kept.
  confirmImport() {
    const p = state.list.import.pending;
    if (p?.kind !== 'confirm') return;
    applyOwn(p.parsed);
    paint();
    focusFk('import-field');
  },
  cancelImport() {
    state.list.import.pending = null;
    paint();
    focusFk('import-field');
  },
  // "Mine" applies the own update; with no username set it also takes the pasted name as my username.
  importAsMine() {
    const p = state.list.import.pending;
    if (p?.kind !== 'whose') return;
    const name = p.parsed.player.name;
    if (!state.players.me && name && isValidName(name)) {
      const r = state.players.setMe(name);
      if (r.conflict) {
        p.error = `${name} is a saved player. Set your username to claim it, or save this build under another name.`;
        return paint();
      }
      if (r.error) {
        p.error = r.error;
        return paint();
      }
    }
    applyOwn(p.parsed);
    paint();
    focusFk('import-field');
  },
  importAs(text) {
    const p = state.list.import.pending;
    if (p?.kind !== 'whose') return;
    const name = text.trim();
    p.nameDraft = text;
    const me = state.players.me;
    p.error = !name ? 'Enter a name for this player' : me && sameName(name, me) ? "That's your username. Choose Mine to update your build." : nameProblem(name, me);
    if (!p.error) p.error = saveImported(p.parsed, name);
    paint();
    if (!p.error) focusFk('import-field');
  },
  setNameDraft(text) {
    state.list.nameDraft = text;
  },
  setTeamNameDraft(name) {
    state.players.renameTeam(name);
  },
  removePlayer(name) {
    state.players.remove(name);
    paint();
  },
  renameTeam(name) {
    state.players.renameTeam(name);
    paint();
  },
  addMember(name) {
    const player = name ? resolvePlayer(name) : null;
    const base = player ? ownedBase(player, player.base) : null;
    if (player && base) state.players.addMember(player.name, base);
    paint();
  },
  removeMember(name) {
    state.players.removeMember(name);
    paint();
    focusFk('team-add');
  },
  setMemberBase(name, base) {
    state.players.setMemberBase(name, base);
    state.copy = null;
    paint();
  },
  // Whether the opened team link is already my team: same name, order, classes, levels and passives.
  linkIsMyTeam() {
    const link = state.team.link;
    return Boolean(link?.members.length) && sameTeam(state.data.classes, state.players.team, link, resolvePlayer);
  },
  // Leaves the opened team link for my own team.
  openMyTeam() {
    state.team.link = null;
    state.notices = [];
    state.copy = null;
    pushPath(window, '/team');
    paint();
  },
  // Replaces my team with the opened link; an existing team, or saved players the link would update, ask first.
  replaceTeamFromLink() {
    const link = state.team.link;
    if (!link?.members.length) return;
    const me = state.players.me;
    const updatesSaved = link.members.some(({ name }) => !(me && sameName(name, me)) && state.players.get(name));
    if (state.players.team.members.length || updatesSaved) {
      link.confirming = true;
      paint();
      return focusFk('replace-yes');
    }
    actions.confirmReplaceTeam();
  },
  cancelReplaceTeam() {
    if (state.team.link) state.team.link.confirming = false;
    paint();
    focusFk('replace-team');
  },
  // My own name maps to Me and is never written; a new player is added from the link; a saved player takes the link's base, its level and its passives for that base.
  confirmReplaceTeam() {
    const link = state.team.link;
    if (!link?.members.length) return;
    const me = state.players.me;
    const members = link.members.map(({ name, player }) => {
      if (me && sameName(name, me)) return { name: me, base: player.base };
      const existing = state.players.get(name);
      state.players.upsert(existing ? { ...player, name: existing.name } : player, { merge: Boolean(existing) });
      return { name: existing?.name ?? name, base: player.base };
    });
    state.players.replaceTeam(link.name, members);
    state.team.link = null;
    state.notices = [];
    state.copy = null;
    replacePath(window, '/team');
    paint();
  },
  // Opens the Builds page and focuses the import box.
  openImport() {
    actions.setView('builds');
    focusFk('import-field');
  },
  setEditing(value) {
    if (state.viewing) return;
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
  jumpToLoadout() {
    document.getElementById('loadout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  setLoadoutEditing(value) {
    state.loadoutEditing = value;
    paint();
  },
  mePlayer: meRecord,
  dismissNotice(i) {
    state.notices = state.notices.filter((_, j) => j !== i);
    paint();
  },
  // Base change pushes a history entry and loads the new base's saved set (empty when none); clearing the base empties the build.
  // Clicking the base already shown from a saved set is a no-op; while a link's passives are shown it reloads the saved set. In a player view see setViewedBase.
  setBase(slug) {
    const base = slug ? classBySlug(slug) : null;
    if (state.viewing) return setViewedBase(base);
    if (base && base.slug === state.build.base?.slug && !state.linkView) return paint();
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
  // Puts a removed saved passive back while a slot is free, then focuses it.
  restoreSlot(slug, level) {
    const cls = classBySlug(slug);
    if (!cls || !state.viewing || state.build.slots.length >= MAX_PASSIVES) return;
    setSlots(addSlot(state.data.classes, state.build.slots, cls, level));
    document.querySelector(`[data-fk="passive-row-${slug}-${level}"]`)?.focus({ preventScroll: true });
  },
  // Drops the experiment for the viewed base and shows the saved set again.
  revertSlots() {
    const v = state.viewing;
    const { base } = state.build;
    if (!v || !base) return;
    state.experiments.delete(expKey(v.player, base.code));
    state.build = { ...state.build, slots: savedBaseSlots(v.player, base) };
    state.copy = null;
    paint();
    document.querySelector('[data-fk="loadout-edit"]')?.focus({ preventScroll: true });
  },
  setUnlockedOnly(value) {
    state.passives.setUnlockedOnly(value);
    paint();
  },
  currentUrl() {
    if (state.view !== 'team') return serializeShare(state.data.classes, sharedRecord(), document.baseURI);
    if (state.team.link) return window.location.href;
    const { path, search } = serializeTeamLink(state.data.classes, state.players.team, (name) => {
      const p = resolvePlayer(name);
      const base = p ? ownedBase(p, p.base) : null;
      return base ? { ...p, base } : null;
    });
    return absoluteUrl(document.baseURI, path + search);
  },
  // Why the team Copy link is unavailable, or null.
  teamShareBlock() {
    if (state.team.link) return null;
    return state.players.team.members.length ? null : 'Add players to share';
  },
  currentCode: () => serializeBuildCode(state.data.classes, sharedRecord(), { roster: true }),
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
    if (name && state.viewing) refreshViewing();
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
    const link = state.viewing?.link;
    if (!link) return;
    link.nameDraft = text;
    link.error = null;
    paint();
  },
  // Saves the opened player to the library; a link without a roster or sets only updates the base and keeps the rest. The view then shows the saved record.
  saveVisitor() {
    const v = state.viewing?.link;
    if (!v) return;
    const name = v.nameDraft.trim();
    if (nameProblem(name, state.players.me)) return;
    const r = state.players.upsert({ ...v.incoming, name }, { merge: v.bare });
    if (r.error) v.error = r.error;
    else {
      v.error = null;
      v.saved = true;
      v.savedName = name;
      const saved = state.players.get(name);
      const { base } = state.build;
      showPlayer(saved, 'library', v, ownedBase(saved, base?.code));
      replacePath(window, viewPath());
    }
    paint();
  },
  // Empty name returns to me. A library name opens that player on their last-saved base and pushes their share link.
  viewPlayer(name) {
    state.copy = null;
    state.notices = [];
    if (!name) {
      restoreLast([]);
      pushPath(window, buildPath());
      return paint();
    }
    const player = state.players.get(name);
    if (!player) return paint();
    showPlayer(player, 'library', null, ownedBase(player, player.base));
    pushPath(window, viewPath());
    paint();
  },
  // Removes the viewed library player from the library and every team, like Remove on the Team page, and returns to me.
  removeViewed() {
    const v = state.viewing;
    if (v?.source !== 'library') return;
    state.players.remove(v.player.name);
    dropExperiments(v.player);
    actions.viewPlayer('');
    document.querySelector('[data-fk="viewing"]')?.focus({ preventScroll: true });
  },
};

// A library view whose incoming link has not been saved keeps that link in the address bar until Update.
const unsavedLink = () => Boolean(state.viewing?.link && !state.viewing.link.saved);

// Base change inside a player view: only classes they own, loading that base's saved set; replaces the history entry.
function setViewedBase(base) {
  const { player } = state.viewing;
  if (!base || (player.levels[base.code] ?? 0) <= 0 || base.slug === state.build.base?.slug) return paint();
  state.build = { base, slots: viewedSlots(player, base) };
  state.loadoutEditing = false;
  state.notices = [];
  state.copy = null;
  if (!unsavedLink()) replacePath(window, viewPath());
  paint();
}

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

// A saved player's view re-reads the record after another tab wrote the stores; a removed player falls back to me.
function refreshViewing() {
  const v = state.viewing;
  if (v.source !== 'library') return;
  const stored = state.players.get(v.player.name);
  if (!stored) {
    dropExperiments(v.player);
    restoreLast([]);
    if (state.view === 'builds') replacePath(window, buildPath());
    return;
  }
  const code = state.build.base?.code;
  const editing = state.loadoutEditing;
  showPlayer(stored, 'library', v.link, ownedBase(stored, code));
  state.loadoutEditing = editing;
  if (state.view === 'builds' && !unsavedLink()) replacePath(window, viewPath());
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
  if (state.viewing) refreshViewing();
  else if (state.build.base && !state.linkView) state.build = { ...state.build, slots: state.passives.get(state.build.base.slug) };
  paint();
});

window.addEventListener('popstate', () => {
  if (state.status !== 'ready') return;
  syncFromLocation();
  paint();
});

load();
