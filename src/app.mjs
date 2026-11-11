import { absoluteUrl, relativePath, pushPath, replacePath, currentPath, teamSegment, addSlot, removeSlot } from './router.mjs';
import { render } from './render.mjs';
import { savedSlots, toSlots, fromSlots } from './passives.mjs';
import { parseShare, parseImport, serializeBuildCode, serializeShare, classByCode } from './code.mjs';
import { isValidName, sameName, ownImport, ownedBase as ownedBaseCode, NAME_RULE } from './players.mjs';
import { createPeopleStore, isUnsavedBuild, buildRaises, ME_ID } from './people.mjs';
import { resolveLocation, importTarget } from './selection.mjs';
import { parseTeamLink, serializeTeamLink, sameTeam } from './team.mjs';

const root = document.getElementById('app');
const storage = { getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) };
const dataUrl = () => new URL('data/classes.json', document.baseURI).href;
const effectsUrl = () => new URL('data/effects.json', document.baseURI).href;

function freshImport() {
  return { draft: '', error: null, message: null, notices: [], pending: null };
}

const state = {
  status: 'loading',
  error: null,
  data: null,
  // The people store: every person, the team, the picker preference and the persisted selection.
  people: null,
  // The person this tab shows; the store keeps the selection for the next load.
  selectedId: ME_ID,
  // The class code shown on Builds; null while the selected person's default class applies.
  baseCode: null,
  // A named link whose player is not saved: { record }. Read-only, never written to the store.
  temp: null,
  // An incoming link for a saved person waiting for Yes or Dismiss: { kind: 'update' | 'ownUpdate', id, incoming }.
  pending: null,
  // A nameless URL build shown on a person until Save: { id, build }.
  unsaved: null,
  // Derived on every paint from the selected person: the record shown, the class and passives shown, and what Save would raise.
  shown: null,
  build: { base: null, slots: [] },
  unsavedRaises: [],
  notices: [],
  passiveFilter: '',
  // True while the loadout panel shows the passive picker.
  loadoutEditing: false,
  // 'copied' (link), 'code-copied', 'failed' (copyText holds the text to select), or null.
  copy: null,
  copyText: '',
  // One-shot: the next paint selects the clipboard fallback field, then clears it.
  copyFocus: false,
  // Local view state; never part of the share URL.
  view: 'builds',
  // Rows expanded by hand in edit mode.
  expanded: new Set(),
  // link: an opened team link, null or { name, members, confirming }; confirming shows the "Replace my team" prompt.
  team: { link: null },
  // True while the import panel under the header is open.
  importOpen: false,
  // import: the import panel's draft, feedback and pending prompt. pending is null, { kind: 'confirm', parsed, summary } or { kind: 'whose', parsed, nameDraft, error }.
  list: { editing: false, filter: '', import: freshImport() },
  // The person cards' form region: form is null or { kind: 'add' | 'menu' | 'rename' | 'delete' | 'save', draft, error }; message is the last outcome, announced politely.
  cards: { form: null, message: '' },
};

const classes = () => state.data.classes;
const classBySlug = (slug) => classes().find((c) => c.slug === slug) ?? null;

// The person the page shows: the temporary record, else the selected saved person.
const shownPerson = () => state.temp?.record ?? state.people.get(state.selectedId) ?? state.people.me;

// A person's own class to show: their stored base, else the first class they own.
function baseFor(person) {
  if (classByCode(classes(), person.base)) return person.base;
  return classes().find((c) => (person.levels[c.code] ?? 0) > 0)?.code ?? null;
}

// Recomputes what the page shows from the selected person. An unsaved build is dropped once saving it would change nothing.
function derive() {
  const person = shownPerson();
  const u = state.unsaved;
  if (u && (state.temp || u.id !== person.id || !isUnsavedBuild(classes(), person, u.build))) state.unsaved = null;
  const build = state.unsaved?.build ?? null;
  const base = classByCode(classes(), build ? build.base : (state.baseCode ?? baseFor(person)));
  let slots = [];
  if (base) slots = build?.passives.length ? toSlots(classes(), build.passives) : savedSlots(classes(), person, base.code);
  state.shown = person;
  state.build = { base, slots };
  state.unsavedRaises = state.unsaved ? buildRaises(classes(), person, state.unsaved.build) : [];
}

const paint = () => {
  if (state.status === 'ready') derive();
  render(root, state, actions);
};

// The person's share link as a base-relative path: their share link with `u` once named, the bare build code while Me is unnamed,
// and '/' when there is no class to share.
function pathOf(person, baseCode) {
  const record = { ...person, base: baseCode };
  if (!serializeBuildCode(classes(), record)) return '/';
  if (!person.name) return `/${serializeBuildCode(classes(), record)}`;
  const url = new URL(serializeShare(classes(), record, document.baseURI));
  return relativePath(url.pathname, new URL(document.baseURI).pathname) + url.search;
}

// Writes the history entry for what is shown: the selected person's share path with { person, base }. A temporary record keeps
// its own link with no state, and a pending update keeps the incoming URL until Yes or Dismiss.
function writeEntry(push) {
  derive();
  const person = state.shown;
  const base = state.build.base?.code ?? null;
  if (state.temp) return replacePath(window, pathOf(person, base));
  if (state.pending) return;
  (push ? pushPath : replacePath)(window, pathOf(person, base), { person: person.id, base });
}

// Makes the saved person the one this tab edits and the store's persisted selection, and returns their id.
function editTarget() {
  state.people.select(state.selectedId);
  return state.selectedId;
}

const clearTransient = () => {
  state.temp = null;
  state.pending = null;
  state.unsaved = null;
};

// The record Copy link and Copy code share: the shown person on the shown class. Unsaved builds never reach it.
const sharedRecord = () => ({ ...state.shown, base: state.build.base?.code ?? null });

// Why Copy link and Copy code are unavailable, or null when sharing works.
function shareBlock() {
  const { base } = state.build;
  if (!base) return 'Pick a class to share';
  return (sharedRecord().levels[base.code] ?? 0) > 0 ? null : `Unlock ${base.name} to share`;
}

// The team as name-keyed members, the view the team link code works on.
const teamByName = () => ({ name: state.people.team.name, members: state.people.team.members.map((m) => ({ name: state.people.get(m.id).name, base: m.base })) });

// A person's record on their own owned class, or null when they own none.
function onOwnedBase(person) {
  const base = person ? ownedBaseCode(classes(), person, person.base) : null;
  return base ? { ...person, base } : null;
}

const resolveByName = (name) => state.people.byName(name);

// Loads state from the location through the selection resolver. Navigation reads the store, so only a link from outside the app
// (no person in the history state) can ask to import, and never without a banner, a temporary card or an unsaved build.
function syncFromLocation() {
  const path = currentPath(window);
  const segment = teamSegment(path);
  state.pending = null;
  state.unsaved = null;
  state.copy = null;
  state.cards = { form: null, message: '' };
  if (path === '/help' || path === '/help/') {
    state.view = 'help';
    state.notices = [];
    return;
  }
  if (segment !== null) {
    state.view = 'team';
    if (segment === '' || segment === '/') {
      state.team.link = null;
      state.notices = [];
      return;
    }
    const parsed = parseTeamLink(classes(), segment, window.location.search);
    state.team.link = { name: parsed.name, members: parsed.members, confirming: false };
    state.notices = parsed.notices;
    return;
  }
  state.view = 'builds';
  state.loadoutEditing = false;
  state.list.editing = false;
  state.expanded.clear();
  state.temp = null;
  const entry = window.history.state;
  let parsed = path === '/' ? null : parseShare(classes(), window.location.pathname + window.location.search, new URL(document.baseURI).pathname);
  // An address-bar URL is a link: a roster in it replaces the saved data.
  if (parsed && !parsed.error) parsed = { ...parsed, isLink: true };
  const outcome = resolveLocation(classes(), state.people, { parsed, state: entry });
  state.notices = parsed?.notices ?? [];
  state.baseCode = outcome.base;
  if (outcome.kind === 'temporary') {
    state.temp = { record: outcome.record };
    return;
  }
  state.people.select(outcome.id);
  state.selectedId = outcome.id;
  if (outcome.kind === 'invalid') state.notices = [{ token: 'link', reason: 'invalid', message: outcome.notice }];
  if (outcome.kind === 'update' || outcome.kind === 'ownUpdate') {
    state.pending = { kind: outcome.kind, id: outcome.id, incoming: outcome.incoming };
    return;
  }
  if (outcome.kind === 'unsaved') {
    state.unsaved = { id: outcome.id, build: outcome.build };
    replacePath(window, currentPath(window) + window.location.search, { target: outcome.id });
    return;
  }
  const linkOpened = parsed && !parsed.error && !entry?.person;
  const person = state.people.get(outcome.id);
  if (linkOpened && outcome.base && person.base !== outcome.base) state.people.setBase(outcome.id, outcome.base);
  if (outcome.replaceUrl) writeEntry(false);
}

function setSlots(slots) {
  if (state.temp || state.unsaved || !state.build.base) return;
  state.notices = [];
  state.copy = null;
  state.people.setSet(editTarget(), state.build.base.code, fromSlots(slots));
  writeEntry(false);
  paint();
}

// What importing `parsed` over the person would replace; a roster code replaces only their classes.
function importSummary(parsed, person = state.people.me) {
  if (parsed.kind === 'roster') {
    const replacesRoster = Object.keys(person.levels).length > 0;
    return { replacesRoster, replacesExisting: replacesRoster };
  }
  return ownImport(person, parsed).summary;
}

const focusFk = (key) => document.querySelector(`[data-fk="${key}"]`)?.focus({ preventScroll: true });

// After a successful import: the selected person's card on Builds, else the panel's View button.
const focusImported = () => focusFk(state.view === 'builds' ? `card-${state.selectedId}` : 'import-view');

const noticeTexts = (notices) => notices.map((n) => n.message);

// Shows the person an import just wrote: selected, on their own class, with the entry for them on Builds; Team and Help keep their
// page and address. The message names the outcome.
function showImported(id, before, message, notices) {
  const moved = before !== id || Boolean(state.temp || state.pending || state.unsaved);
  clearTransient();
  state.selectedId = id;
  state.people.select(id);
  state.baseCode = baseFor(state.people.get(id));
  state.list.editing = false;
  state.loadoutEditing = false;
  state.expanded.clear();
  state.notices = [];
  state.copy = null;
  state.cards = { form: null, message: '' };
  if (state.view === 'builds') writeEntry(moved);
  state.list.import = { ...freshImport(), message, notices: noticeTexts(notices) };
}

// Applies a pasted build or roster to Me.
function applyOwn(parsed) {
  const before = state.selectedId;
  if (parsed.kind === 'roster') {
    state.people.replaceLevels(ME_ID, parsed.owned);
    showImported(ME_ID, before, 'Updated your classes', parsed.notices);
    return;
  }
  state.people.applyImport(parsed, { id: ME_ID });
  showImported(ME_ID, before, 'Updated your build', parsed.notices);
}

// Applies a pasted build to the person with { id } or the person named { name }, creating them when unsaved; returns an error text or null.
function applyToPerson(parsed, target) {
  const before = state.selectedId;
  const r = state.people.applyImport(parsed, target);
  if (r.error) return r.error;
  showImported(r.id, before, `${r.created ? 'Added' : 'Updated'} ${state.people.get(r.id).name}`, parsed.notices);
  return null;
}

// Shows a rejected card form's error inside the region and keeps the field focused.
function failCardForm(error) {
  state.cards.form.error = error;
  paint();
  focusFk('card-name');
}

// Selects a person a card form just created or saved, on their own class, with their entry; the message names the outcome.
function showPerson(id, message) {
  clearTransient();
  state.selectedId = id;
  state.people.select(id);
  state.baseCode = baseFor(state.people.get(id));
  state.list.editing = false;
  state.loadoutEditing = false;
  state.expanded.clear();
  state.notices = [];
  state.copy = null;
  state.cards = { form: null, message };
  writeEntry(true);
  paint();
}

const actions = {
  retry: () => load(),
  // Team has its own URL; leaving it returns to the selected person's URL.
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
      state.team.link = null;
      state.notices = [];
      state.pending = null;
      state.unsaved = null;
      writeEntry(true);
    }
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
  // Classifies the pasted text and routes it by who it belongs to: Me, a saved person, a new person, a team link, or the whose-prompt.
  importText(text) {
    const r = parseImport(classes(), text, new URL(document.baseURI).pathname);
    const imp = state.list.import;
    imp.draft = text;
    imp.message = null;
    imp.notices = [];
    imp.pending = null;
    imp.error = null;
    const target = importTarget(classes(), state.people, r);
    if (target.error) {
      imp.error = target.error;
      return paint();
    }
    if (target.kind === 'team') {
      state.list.import = freshImport();
      state.importOpen = false;
      pushPath(window, target.path);
      syncFromLocation();
      return paint();
    }
    if (target.kind === 'own') {
      const summary = importSummary(r);
      if (summary.replacesExisting) {
        imp.pending = { kind: 'confirm', parsed: r, summary };
        paint();
        return focusFk('import-yes');
      }
      applyOwn(r);
      paint();
      return focusImported();
    }
    if (target.kind === 'person' || target.kind === 'create') {
      imp.error = applyToPerson(r, target.kind === 'person' ? { id: target.id } : { name: target.name });
      paint();
      return imp.error ? null : focusImported();
    }
    imp.pending = { kind: 'whose', parsed: r, nameDraft: target.name, error: null };
    paint();
    focusFk('import-mine');
  },
  // Applies the pending own update against my current data, so edits made while the prompt was open are kept.
  confirmImport() {
    const p = state.list.import.pending;
    if (p?.kind !== 'confirm') return;
    applyOwn(p.parsed);
    paint();
    focusImported();
  },
  cancelImport() {
    state.list.import.pending = null;
    paint();
    focusFk('import-field');
  },
  // "Mine" applies the own update; with no name set it also takes the pasted name as my name.
  importAsMine() {
    const p = state.list.import.pending;
    if (p?.kind !== 'whose') return;
    const name = p.parsed.player.name;
    if (!state.people.me.name && name && isValidName(name)) {
      const problem = state.people.nameProblem(ME_ID, name);
      if (problem) {
        p.error = problem;
        return paint();
      }
      state.people.rename(ME_ID, name);
    }
    applyOwn(p.parsed);
    paint();
    focusImported();
  },
  // "Save as": a saved person's name updates that person, another valid name creates one, and my own name points to Mine.
  importAs(text) {
    const p = state.list.import.pending;
    if (p?.kind !== 'whose') return;
    const name = text.trim();
    p.nameDraft = text;
    const saved = name ? state.people.byName(name) : null;
    const me = state.people.me;
    if (!name) p.error = 'Enter a name for this person';
    else if (me.name && sameName(name, me.name)) p.error = "That's your name. Choose Mine to update your build.";
    else p.error = saved ? null : state.people.nameProblem(null, name);
    if (!p.error) p.error = applyToPerson(p.parsed, saved ? { id: saved.id } : { name });
    paint();
    if (!p.error) focusImported();
  },
  setTeamNameDraft(name) {
    state.people.renameTeam(name);
  },
  renameTeam(name) {
    state.people.renameTeam(name);
    paint();
  },
  addMember(id) {
    const base = ownedBaseCode(classes(), state.people.get(id) ?? { levels: {} }, null);
    if (id && base) state.people.addMember(id, base);
    paint();
  },
  removeMember(id) {
    state.people.removeMember(id);
    paint();
    focusFk('team-add');
  },
  setMemberBase(id, base) {
    state.people.setMemberBase(id, base);
    state.copy = null;
    paint();
  },
  // Whether the opened team link is already my team: same name, order, classes, levels and passives.
  linkIsMyTeam() {
    const link = state.team.link;
    return Boolean(link?.members.length) && sameTeam(classes(), teamByName(), link, resolveByName);
  },
  // Leaves the opened team link for my own team.
  openMyTeam() {
    state.team.link = null;
    state.notices = [];
    state.copy = null;
    pushPath(window, '/team');
    paint();
  },
  // Replaces my team with the opened link; an existing team, or saved people the link would update, ask first.
  replaceTeamFromLink() {
    const link = state.team.link;
    if (!link?.members.length) return;
    if (state.people.team.members.length || actions.linkUpdatesSaved()) {
      link.confirming = true;
      paint();
      return focusFk('replace-yes');
    }
    actions.confirmReplaceTeam();
  },
  // Whether a linked member other than me is already saved, so replacing the team would update them.
  linkUpdatesSaved() {
    const me = state.people.me;
    return Boolean(state.team.link?.members.some(({ name }) => !(me.name && sameName(name, me.name)) && state.people.byName(name)));
  },
  cancelReplaceTeam() {
    if (state.team.link) state.team.link.confirming = false;
    paint();
    focusFk('replace-team');
  },
  // My own name maps to Me and is never written; a new person is added from the link; a saved person takes the link's base, its level and its passives for that base.
  confirmReplaceTeam() {
    const link = state.team.link;
    if (!link?.members.length) return;
    const me = state.people.me;
    const keep = state.selectedId;
    const members = link.members.map(({ name, player }) => {
      if (me.name && sameName(name, me.name)) return { id: ME_ID, base: player.base };
      const existing = state.people.byName(name);
      const parsed = { player, hasRoster: false, hasSets: false, isLink: false };
      const r = state.people.applyImport(parsed, existing ? { id: existing.id } : { name });
      return { id: r.id, base: player.base };
    });
    state.people.select(keep);
    state.people.replaceTeam(link.name, members);
    state.team.link = null;
    state.notices = [];
    state.copy = null;
    replacePath(window, '/team');
    paint();
  },
  // Opens the import panel in place and focuses its field.
  openImport() {
    state.importOpen = true;
    paint();
    focusFk('import-field');
  },
  toggleImport() {
    if (state.importOpen) return actions.closeImport();
    actions.openImport();
  },
  // Closes the panel, drops its prompt and feedback (the typed text stays) and returns focus to the Import button.
  closeImport() {
    state.importOpen = false;
    Object.assign(state.list.import, { pending: null, message: null, error: null, notices: [] });
    paint();
    focusFk('nav-import');
  },
  // The success message's View: closes the panel and shows the imported person on Builds.
  viewImported() {
    state.importOpen = false;
    state.list.import = freshImport();
    actions.setView('builds');
  },
  // Opening class Edit discards an unsaved build; a temporary person is never edited.
  setEditing(value) {
    if (state.temp) return;
    state.list.editing = value;
    state.expanded.clear();
    if (value && state.unsaved) {
      state.unsaved = null;
      writeEntry(false);
    }
    paint();
  },
  // Outside edit mode a row selects its class; in edit mode it only expands.
  selectClass(slug) {
    if (!state.list.editing) return actions.setBase(slug);
    if (!state.expanded.delete(slug)) state.expanded.add(slug);
    paint();
  },
  // A level change saves to the selected person at once and discards an unsaved build.
  setLevel(code, level) {
    if (state.temp) return;
    const hadUnsaved = Boolean(state.unsaved);
    state.unsaved = null;
    state.people.setLevel(editTarget(), code, level);
    if (hadUnsaved) writeEntry(false);
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
    if (value && (state.temp || state.unsaved)) return;
    state.loadoutEditing = value;
    paint();
  },
  dismissNotice(i) {
    state.notices = state.notices.filter((_, j) => j !== i);
    paint();
  },
  // Selecting a class pushes a history entry and stores it as the person's class; selecting the one already shown only discards an unsaved build.
  // A temporary person keeps its own link and a pending update keeps the incoming URL.
  setBase(slug) {
    derive();
    const base = slug ? classBySlug(slug) : null;
    const code = base?.code ?? null;
    if (state.temp) {
      if (base && (state.shown.levels[code] ?? 0) > 0 && code !== state.build.base?.code) {
        state.baseCode = code;
        state.loadoutEditing = false;
        state.notices = [];
        state.copy = null;
        writeEntry(false);
      }
      return paint();
    }
    const same = code === state.build.base?.code;
    if (same && !state.unsaved) return paint();
    state.unsaved = null;
    state.baseCode = code;
    state.people.setBase(editTarget(), code);
    state.loadoutEditing = false;
    state.notices = [];
    state.copy = null;
    writeEntry(!same);
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
    const slots = has ? removeSlot(state.build.slots, cls, level) : addSlot(classes(), state.build.slots, cls, level);
    setSlots(slots);
  },
  clearSlots: () => setSlots([]),
  setUnlockedOnly(value) {
    state.people.setUnlockedOnly(value);
    paint();
  },
  // Saves the unsaved build onto its person, then shows their share path with Copy link back.
  saveBuild() {
    const u = state.unsaved;
    if (!u) return;
    const r = state.people.saveBuild(u.id, u.build);
    if (r.error) return;
    state.unsaved = null;
    state.baseCode = u.build.base;
    state.copy = null;
    state.notices = [];
    writeEntry(false);
    paint();
    focusFk('copy');
  },
  // Yes on the Update banner: applies the incoming link to its person, then shows their share path.
  applyPending() {
    const p = state.pending;
    if (!p) return;
    const r = state.people.applyImport(p.incoming, { id: p.id });
    if (r.error) return;
    state.pending = null;
    state.baseCode = baseFor(state.people.get(p.id));
    state.copy = null;
    writeEntry(false);
    paint();
  },
  // Dismiss leaves the stored data as it is and shows the person's share path.
  dismissPending() {
    if (!state.pending) return;
    state.pending = null;
    writeEntry(false);
    paint();
  },
  // What the pending update replaces, as the import summary of its link over the person's stored data.
  pendingSummary() {
    const p = state.pending;
    return ownImport(state.people.get(p.id), { ...p.incoming, isLink: true }).summary;
  },
  currentUrl() {
    if (state.view !== 'team') return serializeShare(classes(), sharedRecord(), document.baseURI);
    if (state.team.link) return window.location.href;
    const { path, search } = serializeTeamLink(classes(), teamByName(), (name) => onOwnedBase(resolveByName(name)));
    return absoluteUrl(document.baseURI, path + search);
  },
  // Why the team Copy link is unavailable, or null.
  teamShareBlock() {
    if (state.team.link) return null;
    return state.people.team.members.length ? null : 'Add players to share';
  },
  currentCode: () => serializeBuildCode(classes(), sharedRecord(), { roster: true }),
  shareBlock,
  copyLink: () => copyText(actions.currentUrl(), 'copied'),
  copyCode: () => copyText(actions.currentCode(), 'code-copied'),
  // Selects a saved person: pushes their entry and shows their own class. Anything pending or temporary is dropped.
  selectPerson(id) {
    if (!state.people.get(id)) return paint();
    if (id === state.selectedId && !state.temp && !state.pending && !state.unsaved) return paint();
    clearTransient();
    state.selectedId = id;
    state.people.select(id);
    state.baseCode = baseFor(state.people.get(id));
    state.list.editing = false;
    state.loadoutEditing = false;
    state.expanded.clear();
    state.copy = null;
    state.notices = [];
    state.cards = { form: null, message: '' };
    writeEntry(true);
    paint();
  },
  // Opens or closes the selected card's edit menu, focusing its first item.
  toggleCardMenu() {
    if (state.temp) return;
    if (['menu', 'rename', 'delete'].includes(state.cards.form?.kind)) return actions.closeCardForm();
    state.cards = { form: { kind: 'menu', draft: '', error: null }, message: '' };
    paint();
    focusFk('menu-rename');
  },
  // Opens a form in the form region; the "+" card and the temporary card's Save toggle theirs.
  openCardForm(kind) {
    if (state.cards.form?.kind === kind && (kind === 'add' || kind === 'save')) return actions.closeCardForm();
    if (kind === 'save' ? !state.temp : kind === 'add' ? false : state.temp || (kind === 'delete' && state.selectedId === ME_ID)) return;
    const draft = kind === 'rename' ? state.shown.name : kind === 'save' ? state.temp.record.name : '';
    state.cards = { form: { kind, draft, error: null }, message: '' };
    paint();
    focusFk(kind === 'delete' ? 'delete-no' : 'card-name');
    if (kind !== 'delete') document.querySelector('[data-fk="card-name"]')?.select();
  },
  // Draft text stays in state without painting; typing clears the form's error.
  setCardDraft(text) {
    const form = state.cards.form;
    if (!form) return;
    form.draft = text;
    if (form.error) {
      form.error = null;
      paint();
    }
  },
  // Closes the form region and returns focus to the control that opened it.
  closeCardForm() {
    const kind = state.cards.form?.kind;
    if (!kind) return;
    state.cards.form = null;
    paint();
    focusFk(kind === 'add' ? 'card-add' : kind === 'save' ? 'card-temp-save' : 'card-menu');
  },
  // Create, Rename or the temporary card's Save: a rejected name shows its error in the region and changes nothing.
  submitCardForm(text) {
    const form = state.cards.form;
    if (!form) return;
    const name = text.trim();
    form.draft = text;
    if (form.kind === 'rename') {
      const r = state.people.rename(state.selectedId, name);
      if (r.error) return failCardForm(r.error);
      state.cards = { form: null, message: name ? `Renamed to ${name}` : 'Name cleared' };
      if (!state.temp && !state.pending && !state.unsaved) writeEntry(false);
      paint();
      return focusFk('card-menu');
    }
    if (form.kind === 'add') {
      const r = state.people.add(name);
      if (r.error) return failCardForm(r.error);
      showPerson(r.id, `Created ${name}`);
      return focusFk(`card-${r.id}`);
    }
    if (form.kind === 'save') {
      const saved = name ? state.people.byName(name) : null;
      const me = state.people.me;
      if (!name) return failCardForm('Enter a name for this person');
      if (me.name && sameName(name, me.name)) return failCardForm("That's your name. Use Import and choose Mine to update your build.");
      if (!saved) {
        const problem = state.people.nameProblem(null, name);
        if (problem) return failCardForm(problem);
      }
      const { record } = state.temp;
      const parsed = { player: record, hasRoster: record.rosterKnown, hasSets: false, isLink: true };
      const r = state.people.applyImport(parsed, saved ? { id: saved.id } : { name });
      if (r.error) return failCardForm(r.error);
      showPerson(r.id, `Saved ${state.people.get(r.id).name}`);
      return focusFk(`card-${r.id}`);
    }
  },
  // Yes on the delete confirm: the person and their team place are gone and Me is shown.
  confirmDelete() {
    const person = state.people.get(state.selectedId);
    if (state.cards.form?.kind !== 'delete' || !person) return;
    const r = state.people.remove(person.id);
    if (r.error) return;
    clearTransient();
    state.selectedId = ME_ID;
    state.people.select(ME_ID);
    state.baseCode = baseFor(state.people.me);
    state.list.editing = false;
    state.loadoutEditing = false;
    state.expanded.clear();
    state.copy = null;
    state.notices = [];
    state.cards = { form: null, message: `Deleted ${person.name}` };
    writeEntry(false);
    paint();
    focusFk(`card-${ME_ID}`);
  },
};

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
    state.people = createPeopleStore(storage, data.classes);
    state.selectedId = state.people.selected;
    state.status = 'ready';
    syncFromLocation();
  } catch (e) {
    state.status = 'error';
    state.error = { url, message: e.message };
  }
  paint();
}

// Another tab wrote the people entry (or cleared storage): reload it so this tab's next write does not overwrite that change.
// This tab keeps its own selection while that person still exists, else it shows Me.
window.addEventListener('storage', (e) => {
  if (state.status !== 'ready') return;
  if (e.key !== null && e.key !== 'dtec:people') return;
  state.people = createPeopleStore(storage, state.data.classes);
  if (!state.people.get(state.selectedId)) {
    state.selectedId = ME_ID;
    state.cards.form = null;
  }
  if (state.pending && !state.people.get(state.pending.id)) state.pending = null;
  if (state.unsaved && !state.people.get(state.unsaved.id)) state.unsaved = null;
  paint();
});

window.addEventListener('popstate', () => {
  if (state.status !== 'ready') return;
  syncFromLocation();
  paint();
});

load();
