import { MAX_PLAYERS } from './team.mjs';

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
      navButton(state, actions, 'team', 'Team'),
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

// Every passive at once: one row per class (tier order), one toggle cell per level.
// The base class is never listed: a class cannot be its own passive.
// opts: { base, slots, has(code, level), ownedOnly, flag(code, level), filter, filterKey, keyPrefix, label, onFilter, onToggle, onClear }
function passivePicker(state, actions, opts) {
  const { classes, tiers } = state.data;
  const { slots } = opts;
  const full = slots.length >= MAX_SLOTS;
  const picked = (c, n) => slots.some((s) => s.cls.slug === c.slug && s.level === n);
  const f = opts.filter.trim().toLowerCase();
  const ordered = Object.keys(tiers).flatMap((tier) => classes.filter((c) => String(c.tier) === tier));
  const visibleLevels = (c) => [1, 2, 3].filter((n) => picked(c, n) || !opts.ownedOnly || opts.has(c.code, n));
  const rows = ordered.filter((c) => c.slug !== opts.base?.slug && c.name.toLowerCase().includes(f) && visibleLevels(c).length);
  const k = opts.keyPrefix;
  const cell = (c, n) => {
    const on = picked(c, n);
    const blocked = full && !on;
    return h(
      'button',
      {
        type: 'button',
        class: `passive-cell${on ? ' is-selected' : ''}${blocked ? ' is-disabled' : ''}`,
        'data-fk': `${k}-${c.slug}-${n}`,
        'data-level': n,
        'aria-pressed': String(on),
        'aria-disabled': blocked ? 'true' : null,
        'aria-label': `${c.name} level ${n}`,
        onclick: () => (blocked ? null : opts.onToggle(c, n)),
      },
      h('span', { class: 'cell-badge' }, on ? h('span', { class: 'cell-check', 'aria-hidden': 'true', text: '\u2713' }) : null, h('span', { class: 'level-num', text: String(n) })),
      h('span', { class: 'level-text', text: c.levels[n - 1].text }),
      opts.flag(c.code, n) ? notOwned() : null,
    );
  };
  return h(
    'div',
    { class: 'passive-picker' },
    h(
      'div',
      { class: 'passive-head' },
      h('h2', { class: 'panel-title', text: `Passives (${slots.length}/${MAX_SLOTS})` }),
      h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': `${k}-clear`, disabled: !slots.length, onclick: opts.onClear }, 'Clear', hidden(' passives')),
    ),
    h(
      'div',
      { class: 'passive-selected', 'aria-label': 'Selected passives' },
      h('span', { class: 'passive-selected-label', text: 'Selected' }),
      slots.length
        ? h(
            'ul',
            { class: 'sel-chips' },
            slots.map((sl) =>
              h(
                'li',
                { class: 'sel-chip', 'data-level': sl.level },
                h('span', { class: 'sel-chip-name', text: `${sl.cls.name} ${sl.level}` }),
                opts.flag(sl.cls.code, sl.level) ? notOwned() : null,
                h('button', { type: 'button', class: 'sel-chip-x', 'data-fk': `${k}-remove-${sl.cls.slug}-${sl.level}`, 'aria-label': `Remove ${sl.cls.name} ${sl.level}`, onclick: () => opts.onToggle(sl.cls, sl.level), text: '\u00d7' }),
              ),
            ),
          )
        : h('span', { class: 'passive-none', text: 'None' }),
    ),
    full ? h('p', { class: 'passive-hint', role: 'status', text: 'Passives full. Deselect one first.' }) : null,
    h('input', { type: 'search', class: 'picker-filter', 'data-fk': opts.filterKey, 'aria-label': 'Filter passives by class', placeholder: 'Filter passives', value: opts.filter, oninput: (e) => opts.onFilter(e.target.value) }),
    rows.length
      ? h(
          'ul',
          { class: 'passive-rows' },
          rows.map((c) =>
            h(
              'li',
              { class: 'passive-row', 'data-class': c.slug },
              h('div', { class: 'passive-name' }, h('span', { class: 'class-name', text: c.name }), diamonds(c, tiers)),
              h('div', { class: 'passive-cells' }, visibleLevels(c).map((n) => cell(c, n))),
            ),
          ),
        )
      : h('p', { class: 'empty', text: opts.ownedOnly && !opts.hasAny ? 'No owned classes yet. Mark the classes you own in My classes.' : 'No passives match' }),
  );
}

function slotsPanel(state, actions) {
  if (!state.build.base) return null;
  const { store } = state;
  const section = h('section', { class: 'panel slots', 'aria-label': 'Passives' });
  section.append(
    passivePicker(state, actions, {
      base: state.build.base,
      slots: state.build.slots,
      has: (code, n) => store.has(code, n),
      ownedOnly: store.ownedOnly,
      hasAny: store.hasAny(),
      flag: (code, n) => store.hasAny() && !store.has(code, n),
      filter: state.passiveFilter,
      filterKey: 'passive-filter',
      keyPrefix: 'passive',
      onFilter: actions.setPassiveFilter,
      onToggle: (c, n) => actions.toggleSlot(c.slug, n),
      onClear: actions.clearSlots,
    }),
  );
  return section;
}

function combined(state) {
  const { store } = state;
  const { base, slots } = state.build;
  if (!base) return null;
  const rows = [
    ...base.levels.map((l, i) => ({ label: `Base ${i + 1}`, level: i + 1, text: l.text })),
    ...slots.map((s, i) => ({ label: `Passive ${i + 1}`, level: s.level, text: s.cls.levels[s.level - 1].text, from: `${s.cls.name} ${s.level}`, unowned: store.hasAny() && !store.has(s.cls.code, s.level) })),
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
        h('input', { type: 'text', class: 'roster-field', readonly: true, 'data-fk': 'roster-code', 'aria-label': 'Your roster code', value: code, onfocus: (e) => e.target.select() }),
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
                    h('button', { type: 'button', class: 'own-level', 'data-level': n, 'data-fk': `own-${c.slug}-${n}`, 'aria-pressed': String(store.has(c.code, n)), 'aria-label': `${c.name} level ${n}`, onclick: () => actions.setLevel(c.code, n), text: String(n) }),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'empty', text: 'No classes match' }),
    ),
  );
}

function chip(cls, level, unowned) {
  return h('li', { class: 'chip', 'data-level': level }, h('span', { class: 'chip-level', text: String(level) }), h('span', { class: 'chip-name', text: cls.name }), unowned ? notOwned() : null);
}

function cardEditor(state, actions, i) {
  const { classes } = state.data;
  const build = state.team.builds[i];
  const owned = state.team.owned[i];
  return h(
    'div',
    { class: 'card-editor' },
    h(
      'select',
      { class: 'slot-select', 'data-fk': `team-${i}-base`, 'aria-label': `Player ${i + 1} base class`, onchange: (e) => actions.setTeamBase(i, e.target.value || null) },
      h('option', { value: '', text: 'Choose base class' }),
      classes.map((c) => h('option', { value: c.slug, selected: build.base?.slug === c.slug, text: c.name })),
    ),
    build.base
      ? passivePicker(state, actions, {
          base: build.base,
          slots: build.slots,
          has: () => true,
          ownedOnly: false,
          hasAny: false,
          flag: (code, n) => Boolean(owned) && (owned[code] ?? 0) < n,
          filter: state.team.passiveFilter,
          filterKey: `team-${i}-passive-filter`,
          keyPrefix: `team-${i}-passive`,
          onFilter: actions.setTeamPassiveFilter,
          onToggle: (c, n) => actions.toggleTeamSlot(i, c.slug, n),
          onClear: () => actions.clearTeamSlots(i),
        })
      : null,
  );
}

function teamCard(state, actions, i) {
  const { store } = state.team;
  const owned = state.team.owned[i];
  const build = state.team.builds[i];
  const flag = (code, level) => owned && (owned[code] ?? 0) < level;
  const editing = state.team.editing === i;
  const err = state.team.errors[i];
  const hasRoster = Boolean(store.roster(i));
  return h(
    'li',
    { class: 'team-card', 'data-card': i + 1 },
    h('input', { type: 'text', class: 'card-label', 'data-fk': `team-${i}-label`, 'aria-label': `Player ${i + 1} label`, placeholder: `Player ${i + 1}`, maxlength: '24', autocomplete: 'off', value: store.label(i), oninput: (e) => actions.setTeamLabel(i, e.target.value) }),
    build.base
      ? h(
          'div',
          { class: 'card-build' },
          h('p', { class: 'card-base' }, h('span', { class: 'card-base-name', text: build.base.name }), diamonds(build.base, state.data.tiers), owned && !owned[build.base.code] ? notOwned() : null),
          build.slots.length ? h('ul', { class: 'chips' }, build.slots.map((sl) => chip(sl.cls, sl.level, flag(sl.cls.code, sl.level)))) : h('p', { class: 'card-empty', text: 'No passives' }),
        )
      : h('p', { class: 'card-empty', text: 'No class chosen' }),
    editing ? cardEditor(state, actions, i) : null,
    h(
      'div',
      { class: 'card-actions' },
      h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': `team-${i}-edit`, 'aria-expanded': String(editing), onclick: () => actions.editPlayer(i) }, editing ? 'Done' : 'Edit', hidden(` player ${i + 1}`)),
      h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': `team-${i}-remove`, onclick: () => actions.removePlayer(i) }, 'Remove', hidden(` player ${i + 1}`)),
    ),
    h(
      'form',
      { class: 'card-roster', onsubmit: (e) => (e.preventDefault(), actions.importTeamRoster(i, e.target.elements.roster.value)) },
      h('input', { type: 'text', name: 'roster', class: 'roster-field', 'data-fk': `team-${i}-roster`, 'aria-label': `Player ${i + 1} roster code`, placeholder: 'Paste roster code', autocomplete: 'off', spellcheck: 'false', 'aria-invalid': err ? 'true' : null, 'aria-describedby': err ? `team-${i}-error` : null, value: err ? err.draft : store.roster(i) }),
      h('button', { type: 'submit', class: 'btn btn-grey btn-small', 'data-fk': `team-${i}-roster-btn`, text: hasRoster && !err ? 'Update' : 'Set' }),
    ),
    err ? h('p', { class: 'roster-error', id: `team-${i}-error`, role: 'alert', text: err.message }) : null,
  );
}

function teamView(state, actions) {
  const count = state.team.builds.length;
  return h(
    'main',
    { class: 'team' },
    h(
      'section',
      { class: 'panel team-panel', 'aria-label': 'Team' },
      h(
        'div',
        { class: 'panel-head' },
        h('h2', { class: 'panel-title', text: `Team (${count}/${MAX_PLAYERS})` }),
        h('button', { type: 'button', class: 'btn btn-green btn-small', 'data-fk': 'team-add', disabled: count >= MAX_PLAYERS, onclick: actions.addPlayer, text: 'Add player' }),
      ),
      count
        ? h('ul', { class: 'team-grid' }, state.team.builds.map((_, i) => teamCard(state, actions, i)))
        : h('p', { class: 'empty', text: 'No players yet. Add a player to plan a build.' }),
      h('p', { class: 'team-hint', text: 'Roster codes and labels stay in this browser; the link carries builds only.' }),
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
    state.view === 'team'
      ? teamView(state, actions)
      : state.view === 'mine'
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
