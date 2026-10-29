import { groupCode } from './owned.mjs';

// Renders from state only; all data text goes through textContent.
// Interactive elements carry data-fk so focus survives the full re-render.

const MAX_SLOTS = 3;
const TAG_LABEL = { team: 'TEAM', master: 'MASTER' };
const SVG_NS = 'http://www.w3.org/2000/svg';

// Phone picker disclosure: null = automatic (open until a base is chosen).
let pickerOpen = null;

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const hidden = (text) => h('span', { class: 'visually-hidden', text });

function diamond() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'diamond');
  svg.setAttribute('viewBox', '0 0 12 14');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M6 .5 11.5 7 6 13.5.5 7z');
  svg.append(path);
  return svg;
}

function diamonds(cls, tiers) {
  const color = cls.event ? 'orange' : tiers[cls.tier]?.color ?? 'white';
  return h(
    'span',
    { class: 'diamonds', 'data-color': color },
    ...Array.from({ length: cls.tier }, diamond),
    hidden(`Tier ${cls.tier}${cls.event ? ', event' : ''}`),
  );
}

function levelRow(level, index) {
  return h(
    'li',
    { class: 'level', 'data-level': index + 1, 'data-tag': level.tag },
    h(
      'span',
      { class: 'level-chip' },
      h('span', { class: 'level-num', text: String(index + 1) }),
      level.tag ? h('span', { class: 'level-tag', text: TAG_LABEL[level.tag] ?? level.tag }) : null,
    ),
    h('span', { class: 'level-text', text: level.text }),
  );
}

function matches(cls, filter) {
  if (!filter) return true;
  const f = filter.toLowerCase();
  return cls.name.toLowerCase().includes(f) || cls.levels.some((l) => l.text.toLowerCase().includes(f));
}

function loadingPanel() {
  return h('section', { class: 'panel loading', role: 'status' }, h('p', { text: 'Loading classes' }));
}

function errorPanel(error, actions) {
  return h(
    'section',
    { class: 'panel error', role: 'alert' },
    h('p', { text: `Could not load ${error.url}` }),
    error.message ? h('p', { class: 'error-detail', text: error.message }) : null,
    h('button', { type: 'button', class: 'btn btn-green', 'data-fk': 'retry', onclick: actions.retry, text: 'Retry' }),
  );
}

function noticesBar(notices, actions) {
  if (!notices.length) return null;
  return h(
    'div',
    { class: 'notices' },
    notices.map((n, i) =>
      h(
        'p',
        { class: 'notice', role: 'status', 'data-reason': n.reason },
        h('span', { class: 'notice-text', text: n.message }),
        h('button', { type: 'button', class: 'btn btn-small', 'data-fk': `dismiss-${i}`, 'aria-label': `Dismiss notice for ${n.token}`, onclick: () => actions.dismissNotice(i), text: 'Dismiss' }),
      ),
    ),
  );
}

function navButton(state, actions, view, text) {
  const current = state.view === view;
  return h('button', { type: 'button', class: `btn ${current ? 'btn-green' : 'btn-grey'}`, 'data-fk': `nav-${view}`, 'aria-current': current ? 'page' : null, onclick: () => actions.setView(view), text });
}

// Shown only once the player has marked any ownership, so first-time visitors see clean builds.
const notOwned = () => h('span', { class: 'not-owned', text: 'Not owned' });
const ownedMark = () => h('span', { class: 'owned-mark', 'aria-hidden': 'true', text: '\u2713' });

function header(state, actions) {
  const copied = state.copy === 'copied';
  return h(
    'header',
    { class: 'app-header' },
    h('h1', { text: 'Class Combo Viewer' }),
    h(
      'nav',
      { class: 'app-nav', 'aria-label': 'Sections' },
      navButton(state, actions, 'build', 'Build'),
      navButton(state, actions, 'mine', 'My classes'),
      h('button', {
        type: 'button',
        class: 'btn btn-grey',
        'data-fk': 'owned-only',
        'aria-pressed': String(state.store.ownedOnly),
        onclick: () => actions.setOwnedOnly(!state.store.ownedOnly),
        text: 'Owned only',
      }),
    ),
    h(
      'div',
      { class: 'copy-link' },
      h('button', { type: 'button', class: `btn btn-green${copied ? ' is-done' : ''}`, 'data-fk': 'copy', onclick: actions.copyLink, text: copied ? 'Link copied' : 'Copy link' }),
      h('span', { class: 'visually-hidden', role: 'status', text: copied ? 'Link copied' : '' }),
    ),
    state.copy === 'failed'
      ? h('input', { type: 'text', class: 'copy-fallback', readonly: true, 'aria-label': 'Build link', 'data-fk': 'link-field', value: actions.currentUrl(), onfocus: (e) => e.target.select() })
      : null,
  );
}

function picker(state, actions) {
  const { classes, tiers } = state.data;
  const { store } = state;
  const open = pickerOpen ?? !state.build.base;
  const shown = (c) => !store.ownedOnly || store.hasClass(c.code) || state.build.base?.slug === c.slug;
  const groups = Object.keys(tiers)
    .map((tier) => ({ tier, items: classes.filter((c) => String(c.tier) === tier && shown(c) && matches(c, state.filter)) }))
    .filter((g) => g.items.length);
  const panel = h('section', { class: `panel picker${open ? '' : ' is-collapsed'}`, 'aria-label': 'Classes' });
  const toggle = h('button', {
    type: 'button',
    class: 'btn btn-grey picker-toggle',
    'data-fk': 'toggle-picker',
    'aria-expanded': String(open),
    'aria-controls': 'picker-body',
    onclick: () => {
      const next = panel.classList.contains('is-collapsed');
      pickerOpen = next;
      panel.classList.toggle('is-collapsed', !next);
      toggle.setAttribute('aria-expanded', String(next));
    },
    text: 'Change class',
  });
  panel.append(
    h('h2', { class: 'panel-title picker-title', text: 'Classes' }),
    toggle,
    h(
      'div',
      { class: 'picker-body', id: 'picker-body' },
      h('input', { type: 'search', class: 'picker-filter', 'data-fk': 'filter', 'aria-label': 'Filter classes', placeholder: 'Filter classes', value: state.filter, oninput: (e) => actions.setFilter(e.target.value) }),
      groups.length
        ? groups.map((g) =>
            h(
              'div',
              { class: 'tier', 'data-tier': g.tier },
              h('h3', { text: `Tier ${g.tier}` }),
              h(
                'ul',
                { class: 'class-list' },
                g.items.map((c) =>
                  h(
                    'li',
                    {},
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'class-button',
                        'data-fk': `class-${c.slug}`,
                        'aria-pressed': state.build.base?.slug === c.slug ? 'true' : 'false',
                        onclick: () => {
                          pickerOpen = null;
                          actions.setBase(c.slug);
                        },
                      },
                      h('span', { class: 'class-name' }, c.name, store.hasClass(c.code) ? [ownedMark(), hidden(' owned')] : null),
                      diamonds(c, tiers),
                    ),
                  ),
                ),
              ),
            ),
          )
        : store.ownedOnly && !store.hasAny() && !state.filter
          ? h(
              'div',
              { class: 'empty' },
              h('p', { text: 'No owned classes yet. Mark the classes you own in My classes.' }),
              h('button', { type: 'button', class: 'btn btn-green', 'data-fk': 'empty-to-mine', onclick: () => actions.setView('mine'), text: 'Open My classes' }),
            )
          : h('p', { class: 'empty', text: 'No classes match' }),
    ),
  );
  return panel;
}

function baseLevels(state, actions) {
  const base = state.build.base;
  if (!base) {
    return h('section', { class: 'panel base', 'aria-label': 'Base class' }, h('p', { class: 'empty', text: 'Choose a base class' }));
  }
  return h(
    'section',
    { class: 'panel base', 'aria-label': 'Base class' },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', { class: 'panel-title' }, h('span', { text: base.name }), diamonds(base, state.data.tiers), !state.store.hasAny() || state.store.hasClass(base.code) ? null : notOwned()),
      h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': 'clear-base', onclick: () => actions.setBase(null) }, 'Clear', hidden(` base ${base.name}`)),
    ),
    h('ol', { class: 'levels' }, base.levels.map(levelRow)),
  );
}

function slotView(state, actions, index) {
  const slot = state.build.slots[index];
  const { classes } = state.data;
  const { store } = state;
  const ownedLevels = (c) => [1, 2, 3].filter((n) => store.has(c.code, n));
  const choices = store.ownedOnly ? classes.filter((c) => ownedLevels(c).length || slot?.cls.slug === c.slug) : classes;
  const select = h(
    'select',
    {
      class: 'slot-select',
      'data-fk': `slot-${index}-select`,
      'aria-label': `Slot ${index + 1} class`,
      onchange: (e) => {
        const c = classes.find((x) => x.slug === e.target.value);
        actions.setSlot(index, c?.slug ?? null, (store.ownedOnly && c && ownedLevels(c)[0]) || 1);
      },
    },
    h('option', { value: '', text: 'Choose class' }),
    choices.map((c) => h('option', { value: c.slug, selected: slot?.cls.slug === c.slug, text: c.name })),
  );
  const label = h('span', { class: 'slot-label', text: `Slot ${index + 1}` });
  if (!slot) return h('li', { class: 'slot empty', 'data-slot': index + 1 }, h('div', { class: 'slot-head' }, label), select);
  return h(
    'li',
    { class: 'slot filled', 'data-slot': index + 1, 'data-level': slot.level },
    h('div', { class: 'slot-head' }, label, !store.hasAny() || store.has(slot.cls.code, slot.level) ? null : notOwned(), h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': `clear-slot-${index}`, onclick: () => actions.clearSlot(index) }, 'Clear', hidden(` slot ${index + 1}`))),
    select,
    h(
      'div',
      { class: 'slot-levels', role: 'group', 'aria-label': `Slot ${index + 1} level` },
      [1, 2, 3]
        .filter((n) => !store.ownedOnly || store.has(slot.cls.code, n) || slot.level === n)
        .map((n) =>
        h('button', {
          type: 'button',
          class: 'level-button',
          'data-fk': `slot-${index}-lv-${n}`,
          'data-level': n,
          'aria-pressed': slot.level === n ? 'true' : 'false',
          'aria-label': `Level ${n}`,
          onclick: () => actions.setSlot(index, slot.cls.slug, n),
          text: String(n),
        }),
      ),
    ),
    h('p', { class: 'slot-text', text: slot.cls.levels[slot.level - 1].text }),
  );
}

function slotsPanel(state, actions) {
  if (!state.build.base) return null;
  return h(
    'section',
    { class: 'panel slots', 'aria-label': 'Passive slots' },
    h('h2', { class: 'panel-title', text: 'Passive Slots' }),
    h('ol', { class: 'slot-list' }, Array.from({ length: MAX_SLOTS }, (_, i) => slotView(state, actions, i))),
  );
}

function combined(state) {
  const { store } = state;
  const { base, slots } = state.build;
  if (!base) return null;
  const rows = [
    ...base.levels.map((l, i) => ({ label: `Base ${i + 1}`, level: i + 1, text: l.text })),
    ...slots.map((s, i) => ({ label: `Slot ${i + 1}`, level: s.level, text: s.cls.levels[s.level - 1].text, from: `${s.cls.name} ${s.level}`, unowned: store.hasAny() && !store.has(s.cls.code, s.level) })),
  ];
  return h(
    'section',
    { class: 'panel combined', 'aria-label': 'Combined effects' },
    h('h2', { class: 'panel-title', text: 'Combined Effects' }),
    base.slug === 'recruit' ? h('p', { class: 'recruit-note', text: base.levels[4].text }) : null,
    h(
      'ul',
      { class: 'combined-rows' },
      rows.map((r) =>
        h(
          'li',
          { class: 'row', 'data-level': r.level },
          h('span', { class: 'row-label', text: r.label }),
          h('span', { class: 'row-body' }, r.from ? h('span', { class: 'row-from' }, r.from, r.unowned ? notOwned() : null) : null, h('span', { class: 'level-text', text: r.text })),
        ),
      ),
    ),
  );
}

function mineView(state, actions) {
  const { classes, tiers } = state.data;
  const { store, mine } = state;
  const f = mine.filter.trim().toLowerCase();
  const rows = classes
    .filter((c) => c.name.toLowerCase().includes(f) && (!mine.ownedOnly || store.hasClass(c.code)))
    .sort((a, b) => a.tier - b.tier);
  const code = actions.rosterCode();
  const segment = (label, value) =>
    h('button', { type: 'button', class: 'btn btn-small btn-grey', 'data-fk': `mine-${label}`, 'aria-pressed': String(mine.ownedOnly === value), onclick: () => actions.setMineOwnedOnly(value), text: label });
  return h(
    'main',
    { class: 'mine' },
    h(
      'section',
      { class: 'panel roster', 'aria-label': 'Roster code' },
      h('h2', { class: 'panel-title', text: 'Roster code' }),
      h(
        'div',
        { class: 'roster-row' },
        h('input', { type: 'text', class: 'roster-field', readonly: true, 'data-fk': 'roster-code', 'aria-label': 'Your roster code', value: groupCode(code), onfocus: (e) => e.target.select() }),
        h('button', { type: 'button', class: `btn btn-green${mine.copy === 'copied' ? ' is-done' : ''}`, 'data-fk': 'roster-copy', onclick: actions.copyRoster, text: mine.copy === 'copied' ? 'Copied' : mine.copy === 'failed' ? 'Copy failed' : 'Copy' }),
      ),
      h(
        'form',
        { class: 'roster-row', onsubmit: (e) => (e.preventDefault(), actions.importRoster(e.target.elements.roster.value)) },
        h('input', { type: 'text', name: 'roster', class: 'roster-field', 'data-fk': 'roster-import', 'aria-label': 'Paste a roster code', placeholder: 'Paste a roster code', autocomplete: 'off', spellcheck: 'false', 'aria-invalid': mine.error ? 'true' : null, 'aria-describedby': mine.error ? 'roster-error' : null, value: mine.draft }),
        h('button', { type: 'submit', class: 'btn btn-grey', 'data-fk': 'roster-import-btn', text: 'Import' }),
      ),
      mine.error ? h('p', { class: 'roster-error', id: 'roster-error', role: 'alert', text: mine.error }) : null,
      mine.notices.map((n) => h('p', { class: 'roster-notice', role: 'status', text: n })),
    ),
    h(
      'section',
      { class: 'panel mine-grid-panel', 'aria-label': 'My classes' },
      h('h2', { class: 'panel-title', text: 'My classes' }),
      h(
        'div',
        { class: 'mine-controls' },
        h('input', { type: 'search', class: 'picker-filter', 'data-fk': 'mine-filter', 'aria-label': 'Filter my classes', placeholder: 'Filter classes', value: mine.filter, oninput: (e) => actions.setMineFilter(e.target.value) }),
        h('div', { class: 'segment', role: 'group', 'aria-label': 'Show' }, segment('All classes', false), segment('Owned only', true)),
      ),
      rows.length
        ? h(
            'ul',
            { class: 'mine-grid' },
            rows.map((c) =>
              h(
                'li',
                { class: 'mine-row', 'data-class': c.slug },
                h(
                  'label',
                  { class: 'mine-name' },
                  h('input', { type: 'checkbox', 'data-fk': `own-${c.slug}`, checked: store.hasClass(c.code), onchange: () => actions.toggleClass(c.code) }),
                  h('span', { text: c.name }),
                ),
                diamonds(c, tiers),
                h(
                  'div',
                  { class: 'own-levels', role: 'group', 'aria-label': `${c.name} levels` },
                  [1, 2, 3, 4, 5].map((n) =>
                    h('button', { type: 'button', class: 'own-level', 'data-level': n, 'data-fk': `own-${c.slug}-${n}`, 'aria-pressed': String(store.has(c.code, n)), 'aria-label': `${c.name} level ${n}`, onclick: () => actions.toggleLevel(c.code, n), text: String(n) }),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'empty', text: 'No classes match' }),
    ),
  );
}

function focusKey(root) {
  const active = document.activeElement;
  return active && root.contains(active) ? active.getAttribute('data-fk') : null;
}

function restoreFocus(root, key) {
  if (!key) return;
  const next = [...root.querySelectorAll('[data-fk]')].find((el) => el.getAttribute('data-fk') === key);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (next.type === 'search') next.setSelectionRange(next.value.length, next.value.length);
}

// Replaces root's content from state. state.status is 'loading' | 'error' | 'ready'.
export function render(root, state, actions) {
  const key = focusKey(root);
  root.replaceChildren();
  if (state.status === 'loading') return void root.append(loadingPanel());
  if (state.status === 'error') return void root.append(errorPanel(state.error, actions));
  root.append(
    header(state, actions),
    ...[noticesBar(state.notices, actions)].filter(Boolean),
    state.view === 'mine'
      ? mineView(state, actions)
      : h(
          'main',
          { class: 'layout' },
          picker(state, actions),
          baseLevels(state, actions),
          h('div', { class: 'build' }, slotsPanel(state, actions), combined(state)),
        ),
  );
  if (state.copy === 'failed') root.querySelector('.copy-fallback')?.select();
  else restoreFocus(root, key);
}
