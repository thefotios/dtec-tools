import { parsePath, serializePath, absoluteUrl, pushBuild, replaceBuild, currentPath, MAX_SLOTS } from './router.mjs';
import { render } from './render.mjs';
import { createStore, encodeRoster, decodeRoster } from './owned.mjs';

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
  mine: { filter: '', ownedOnly: false, draft: '', error: null, notices: [], copy: null },
};

const paint = () => render(root, state, actions);

// Loads state.build from the location; rewrites a non-canonical URL without adding history.
function syncFromLocation() {
  const path = currentPath(window);
  const parsed = parsePath(state.data.classes, path);
  state.build = { base: parsed.base, slots: parsed.slots };
  state.notices = parsed.notices;
  state.copy = null;
  if (serializePath(parsed) !== path) replaceBuild(window, parsed);
}

const classBySlug = (slug) => state.data.classes.find((c) => c.slug === slug) ?? null;

const actions = {
  retry: () => load(),
  setFilter(value) {
    state.filter = value;
    paint();
  },
  setView(view) {
    state.view = view;
    paint();
  },
  setOwnedOnly(value) {
    state.store.setOwnedOnly(value);
    paint();
  },
  toggleLevel(code, level) {
    state.store.toggleLevel(code, level);
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
  currentUrl: () => absoluteUrl(document.baseURI, serializePath(state.build)),
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
