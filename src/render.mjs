import { MAX_PLAYERS } from './team.mjs';
import { ownedClasses } from './owned.mjs';
import { isValidName } from './players.mjs';
import { toSlots } from './passives.mjs';

// Renders from state only; all data text goes through textContent.
// Interactive elements carry data-fk so focus survives the full re-render.

const MAX_SLOTS = 3;
const TAG_LABEL = { team: 'TEAM', master: 'MASTER' };
const SVG_NS = 'http://www.w3.org/2000/svg';

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

function levelChip(level, index) {
  return h(
    'span',
    { class: 'level-chip' },
    h('span', { class: 'level-num', text: String(index + 1) }),
    level.tag ? h('span', { class: 'level-tag', text: TAG_LABEL[level.tag] ?? level.tag }) : null,
  );
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

const notOwned = () => h('span', { class: 'not-owned', text: 'Not owned' });

const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

function shareButtons(state, actions) {
  const block = actions.shareBlock();
  const copied = state.copy === 'copied';
  const codeCopied = state.copy === 'code-copied';
  const described = block ? 'share-hint' : null;
  return [
    h('button', { type: 'button', class: `btn btn-grey${codeCopied ? ' is-done' : ''}`, 'data-fk': 'copy-code', disabled: Boolean(block), 'aria-describedby': described, onclick: actions.copyCode, text: codeCopied ? 'Code copied' : 'Copy my code' }),
    h('button', { type: 'button', class: `btn btn-green${copied ? ' is-done' : ''}`, 'data-fk': 'copy', disabled: Boolean(block), 'aria-describedby': described, onclick: actions.copyLink, text: copied ? 'Link copied' : 'Copy link' }),
    block ? h('span', { class: 'share-hint', id: 'share-hint', text: block }) : null,
    h('span', { class: 'visually-hidden', role: 'status', text: copied ? 'Link copied' : codeCopied ? 'Code copied' : '' }),
  ];
}

function header(state, actions) {
  const copied = state.copy === 'copied';
  return h(
    'header',
    { class: 'app-header' },
    h('h1', { text: 'Class Combo Viewer' }),
    h(
      'nav',
      { class: 'app-nav', 'aria-label': 'Sections' },
      navButton(state, actions, 'classes', 'Classes'),
      navButton(state, actions, 'team', 'Team'),
    ),
    h(
      'div',
      { class: 'copy-link' },
      state.view === 'team'
        ? [
            h('button', { type: 'button', class: `btn btn-green${copied ? ' is-done' : ''}`, 'data-fk': 'copy', onclick: actions.copyLink, text: copied ? 'Link copied' : 'Copy link' }),
            h('span', { class: 'visually-hidden', role: 'status', text: copied ? 'Link copied' : '' }),
          ]
        : shareButtons(state, actions),
    ),
    state.copy === 'failed'
      ? h('input', { type: 'text', class: 'copy-fallback', readonly: true, 'aria-label': 'Text to copy', 'data-fk': 'link-field', value: state.copyText, onfocus: (e) => e.target.select() })
      : null,
  );
}

// One class in the list. Outside edit mode rows stay closed and tapping a row selects it as the base; in edit mode rows expand independently.
function ownRow(state, actions, cls) {
  const { store } = state;
  const max = store.owned[cls.code] ?? 0;
  const editing = state.list.editing;
  const selected = state.build.base?.slug === cls.slug;
  const open = editing && state.expanded.has(cls.slug);
  const k = `own-${cls.slug}`;
  return h(
    'li',
    { class: `own-row${open ? ' is-open' : ''}${selected ? ' is-selected' : ''}`, 'data-class': cls.slug },
    h(
      'div',
      { class: 'own-head' },
      h(
        'button',
        { type: 'button', class: 'own-toggle', 'data-fk': k, 'aria-expanded': editing ? String(open) : null, 'aria-controls': editing ? `${k}-levels` : null, 'aria-pressed': editing ? null : String(selected), onclick: () => actions.selectClass(cls.slug) },
        h('span', { class: 'class-name' }, cls.name, selected && !max ? notOwned() : null),
        diamonds(cls, state.data.tiers),
        editing ? h('span', { class: 'own-chevron', 'aria-hidden': 'true', text: '\u25be' }) : null,
      ),
      max
        ? h('span', { class: 'own-pill is-owned', 'data-level': max }, `L${max}`, hidden(` owned, level ${max}`))
        : !editing
        ? null
        : h('button', { type: 'button', class: 'own-pill', 'data-fk': `${k}-buy`, 'aria-label': `Buy ${cls.name}`, onclick: () => actions.setLevel(cls.code, 1), text: '+' }),
    ),
    open
      ? h(
          'div',
          { class: 'own-body', id: `${k}-levels` },
          h(
            'ol',
            { class: 'levels' },
            cls.levels.map((level, i) => {
              const on = store.has(cls.code, i + 1);
              const parts = [levelChip(level, i), h('span', { class: 'level-text', text: level.text }), h('span', { class: 'own-check', 'aria-hidden': 'true', text: on ? '\u2713' : '' })];
              const cn = `level own-level${on ? ' is-unlocked' : ''}`;
              return h(
                'li',
                {},
                editing
                  ? h('button', { type: 'button', class: cn, 'data-level': i + 1, 'data-tag': level.tag, 'data-fk': `${k}-${i + 1}`, 'aria-pressed': String(on), onclick: () => actions.setLevel(cls.code, i + 1) }, parts)
                  : h('div', { class: `${cn} is-readonly`, 'data-level': i + 1, 'data-tag': level.tag }, parts, hidden(on ? ' unlocked' : ' locked')),
              );
            }),
          ),
          editing && max ? h('button', { type: 'button', class: 'btn btn-red btn-small own-remove', 'data-fk': `${k}-remove`, onclick: () => actions.setLevel(cls.code, 0) }, 'Remove class', hidden(` ${cls.name}`)) : null,
        )
      : null,
  );
}

// Every passive at once: one row per class (tier order), one toggle cell per level.
// The base class is never listed: a class cannot be its own passive.
// opts: { noTitle (omit the heading), levelRows (render owned classes as ownership-style level rows; locked levels shown gray unless unlockedOnly), unlockedOnly, onUnlockedOnly, base, slots, has(code, level), ownedOnly (list only owned levels, plus selected), emptyText (shown when ownedOnly leaves nothing), flag(code, level), filter, filterKey, keyPrefix, label, onFilter, onToggle, onClear }
function passivePicker(state, actions, opts) {
  const { classes, tiers } = state.data;
  const { slots } = opts;
  const full = slots.length >= MAX_SLOTS;
  const picked = (c, n) => slots.some((s) => s.cls.slug === c.slug && s.level === n);
  const f = opts.filter.trim().toLowerCase();
  const ordered = Object.keys(tiers).flatMap((tier) => classes.filter((c) => String(c.tier) === tier));
  const visibleLevels = (c) => [1, 2, 3].filter((n) => picked(c, n) || !opts.ownedOnly || opts.has(c.code, n));
  const hasPicked = (c) => slots.some((s) => s.cls.slug === c.slug);
  const levelRowsVisible = (c) => [1, 2, 3].filter((n) => picked(c, n) || !opts.unlockedOnly || opts.has(c.code, n));
  const rows = opts.levelRows
    ? ordered.filter((c) => c.slug !== opts.base?.slug && c.name.toLowerCase().includes(f) && (opts.has(c.code, 1) || hasPicked(c)) && levelRowsVisible(c).length)
    : ordered.filter((c) => c.slug !== opts.base?.slug && c.name.toLowerCase().includes(f) && visibleLevels(c).length);
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
  // Ownership-style row: all levels written out; locked levels (above the owned max) are gray and not selectable.
  const levelRow = (c) => {
    const max = state.store.owned[c.code] ?? 0;
    return h(
      'li',
      { class: 'own-row passive-own', 'data-class': c.slug },
      h(
        'div',
        { class: 'own-head' },
        h('span', { class: 'own-toggle passive-own-name' }, h('span', { class: 'class-name', text: c.name }), diamonds(c, tiers)),
        max ? h('span', { class: 'own-pill is-owned', 'data-level': max }, `L${max}`, hidden(` owned, level ${max}`)) : notOwned(),
      ),
      h(
        'div',
        { class: 'own-body' },
        h(
          'ol',
          { class: 'levels' },
          levelRowsVisible(c).map((n) => {
            const on = picked(c, n);
            const locked = !opts.has(c.code, n);
            const blocked = !on && (locked || full);
            return h(
              'li',
              {},
              h(
                'button',
                {
                  type: 'button',
                  class: `level own-level passive-level${on ? ' is-selected' : ''}${locked ? ' is-locked' : ' is-unlocked'}${!locked && blocked ? ' is-disabled' : ''}`,
                  'data-level': n,
                  'data-fk': `${k}-${c.slug}-${n}`,
                  'aria-pressed': String(on),
                  'aria-disabled': blocked ? 'true' : null,
                  'aria-label': `${c.name} level ${n}${locked ? ', locked' : ''}`,
                  onclick: () => (blocked ? null : opts.onToggle(c, n)),
                },
                levelChip(c.levels[n - 1], n - 1),
                h('span', { class: 'level-text', text: c.levels[n - 1].text }),
                locked ? (on ? notOwned() : h('span', { class: 'lock-hint', title: `Own ${c.name} at level ${n} to unlock`, text: 'Locked' })) : null,
                h('span', { class: 'own-check', 'aria-hidden': 'true', text: on ? '\u2713' : '' }),
              ),
            );
          }),
        ),
      ),
    );
  };
  return h(
    'div',
    { class: 'passive-picker' },
    h(
      'div',
      { class: 'passive-head' },
      opts.noTitle ? null : h('h2', { class: 'panel-title', text: `Passives (${slots.length}/${MAX_SLOTS})` }),
      opts.levelRows
        ? h(
            'label',
            { class: 'unlocked-only' },
            h('input', { type: 'checkbox', 'data-fk': `${k}-unlocked-only`, checked: opts.unlockedOnly, onchange: (e) => opts.onUnlockedOnly(e.target.checked) }),
            h('span', { text: 'Unlocked only' }),
          )
        : null,
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
          { class: opts.levelRows ? 'own-list' : 'passive-rows' },
          rows.map((c) =>
            opts.levelRows ? levelRow(c) : h(
              'li',
              { class: 'passive-row', 'data-class': c.slug },
              h('div', { class: 'passive-name' }, h('span', { class: 'class-name', text: c.name }), diamonds(c, tiers)),
              h('div', { class: 'passive-cells' }, visibleLevels(c).map((n) => cell(c, n))),
            ),
          ),
        )
      : h('p', { class: 'empty', text: !f && opts.ownedOnly && opts.emptyText ? opts.emptyText : 'No passives match' }),
  );
}

function pickerEditor(state, actions) {
  const { store } = state;
  return passivePicker(state, actions, {
    noTitle: true,
    base: state.build.base,
    slots: state.build.slots,
    has: (code, n) => store.has(code, n),
    ownedOnly: true,
    levelRows: true,
    unlockedOnly: state.passives.unlockedOnly,
    onUnlockedOnly: actions.setUnlockedOnly,
    flag: (code, n) => !store.has(code, n),
    emptyText: 'No owned passives to pick. Mark classes in the class list.',
    filter: state.passiveFilter,
    filterKey: 'passive-filter',
    keyPrefix: 'passive',
    onFilter: actions.setPassiveFilter,
    onToggle: (c, n) => actions.toggleSlot(c.slug, n),
    onClear: actions.clearSlots,
  });
}

// A selected passive written out like a level row, headed by its class.
function passiveRow(slot, owned) {
  const { cls, level } = slot;
  return h(
    'li',
    { class: 'level passive-read', 'data-level': level },
    levelChip(cls.levels[level - 1], level - 1),
    h(
      'span',
      { class: 'level-text' },
      h('span', { class: 'passive-line' }, h('span', { class: 'row-from' }, cls.name, (owned[cls.code] ?? 0) >= level ? null : notOwned()), h('span', { text: cls.levels[level - 1].text })),
    ),
  );
}

// The selected class's five levels, unlocked ones in color and locked ones dimmed.
function basePanel(state, base, owned) {
  return h(
    'section',
    { class: 'panel base-levels', 'aria-label': `${base.name} levels` },
    h('h2', { class: 'panel-title' }, h('span', { text: base.name }), diamonds(base, state.data.tiers), (owned[base.code] ?? 0) > 0 ? null : notOwned()),
    h(
      'ol',
      { class: 'levels' },
      base.levels.map((level, i) => {
        const on = (owned[base.code] ?? 0) >= i + 1;
        return h(
          'li',
          {},
          h(
            'div',
            { class: `level own-level is-readonly${on ? ' is-unlocked' : ''}`, 'data-level': i + 1, 'data-tag': level.tag },
            levelChip(level, i),
            h('span', { class: 'level-text', text: level.text }),
            on ? null : h('span', { class: 'lock-hint', text: 'Locked' }),
          ),
        );
      }),
    ),
  );
}

function visitorNameError(state) {
  const v = state.visitor;
  const name = v.nameDraft.trim();
  if (!name) return 'Enter a name to save this build';
  if (!isValidName(name)) return 'Use 3 to 20 letters or digits, with at most one underscore that is not at either end';
  if (state.players.me && sameName(name, state.players.me)) return "That's you";
  return null;
}

// Banner, name field, and save button for another player's opened link.
function visitorBanner(state, actions) {
  const v = state.visitor;
  const error = visitorNameError(state);
  const name = v.nameDraft.trim();
  const isSaved = v.saved && sameName(name, v.savedName);
  const existing = !error && state.players.get(name);
  const shown = v.error ?? (v.nameDraft ? error : null);
  return h(
    'section',
    { class: 'panel visitor-banner', 'aria-label': 'Shared build' },
    h('h2', { class: 'panel-title', text: v.player.name ? `${v.player.name}'s build` : 'Shared build' }),
    h(
      'form',
      { class: 'visitor-form', onsubmit: (e) => (e.preventDefault(), isSaved ? null : actions.saveVisitor()) },
      h('label', { class: 'field-label', for: 'visitor-name', text: 'Player name' }),
      h(
        'div',
        { class: 'roster-row' },
        h('input', { type: 'text', id: 'visitor-name', class: 'roster-field', 'data-fk': 'visitor-name', autocomplete: 'off', spellcheck: 'false', maxlength: '40', 'aria-invalid': shown ? 'true' : null, 'aria-describedby': 'visitor-msg', value: v.nameDraft, oninput: (e) => actions.setVisitorName(e.target.value) }),
        isSaved
          ? h('button', { type: 'button', class: 'btn btn-grey is-done', 'data-fk': 'visitor-save', disabled: true, text: 'Saved' })
          : h('button', { type: 'submit', class: 'btn btn-green', 'data-fk': 'visitor-save', disabled: Boolean(error), text: existing ? `Update ${existing.name}` : 'Save to players' }),
      ),
      h('div', { id: 'visitor-msg', class: 'field-msg', 'aria-live': 'polite' },
        shown ? h('p', { class: 'roster-error', role: 'alert', text: shown }) : null,
        isSaved
          ? h('p', { class: 'visitor-saved', role: 'status' }, `Saved ${v.savedName}. `, h('a', { class: 'visitor-team-link', 'data-fk': 'visitor-team', href: new URL('team', document.baseURI).href, onclick: (e) => (e.preventDefault(), actions.setView('team')), text: 'Open the Team page' }))
          : null,
      ),
    ),
  );
}

function visitorLoadout(state, actions) {
  const { player } = state.visitor;
  const base = state.data.classes.find((c) => c.code === player.base);
  const slots = toSlots(state.data.classes, player.sets[player.base] ?? []);
  return h(
    'div',
    { class: 'loadout-col' },
    visitorBanner(state, actions),
    basePanel(state, base, player.levels),
    h(
      'section',
      { class: 'panel loadout', id: 'loadout', 'aria-label': 'Loadout' },
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title', text: `${base.name} passives (${slots.length}/${MAX_SLOTS})` })),
      h('div', { class: 'loadout-read' }, slots.length ? h('ol', { class: 'levels' }, slots.map((sl) => passiveRow(sl, player.levels))) : h('p', { class: 'empty', text: 'No passives in this build.' })),
    ),
  );
}

function loadout(state, actions) {
  if (state.visitor) return visitorLoadout(state, actions);
  const { base, slots } = state.build;
  if (!base) {
    return h('section', { class: 'panel loadout', id: 'loadout', 'aria-label': 'Loadout' }, h('p', { class: 'empty', text: 'Pick a class to see its loadout.' }));
  }
  const editing = state.loadoutEditing;
  const owned = state.store.owned;
  return h(
    'div',
    { class: 'loadout-col' },
    basePanel(state, base, owned),
    h(
      'section',
      { class: 'panel loadout', id: 'loadout', 'aria-label': 'Loadout' },
      h(
        'div',
        { class: 'panel-head' },
        h('h2', { class: 'panel-title', text: `${base.name} passives (${slots.length}/${MAX_SLOTS})` }),
        h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'loadout-edit', 'aria-pressed': String(editing), onclick: () => actions.setLoadoutEditing(!editing), text: editing ? 'Done' : 'Edit' }),
      ),
      editing
        ? pickerEditor(state, actions)
        : h(
            'div',
            { class: 'loadout-read' },
            slots.length ? h('ol', { class: 'levels' }, slots.map((sl) => passiveRow(sl, owned))) : h('p', { class: 'empty', text: 'No passives yet. Tap Edit to pick up to 3.' }),
            slots.length ? h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': 'passive-clear', onclick: actions.clearSlots }, 'Clear', hidden(' passives')) : null,
          ),
    ),
  );
}

// Username: saves on change; an invalid name shows an inline error, a saved player's name asks for confirmation.
function usernameField(state, actions) {
  const { list } = state;
  const value = list.nameDraft ?? state.players.me;
  const msgId = 'username-msg';
  return h(
    'div',
    { class: 'username' },
    h('label', { class: 'field-label', for: 'username', text: 'Username' }),
    h(
      'div',
      { class: 'roster-row' },
      h('input', { type: 'text', id: 'username', class: 'roster-field', 'data-fk': 'username', autocomplete: 'off', spellcheck: 'false', maxlength: '40', placeholder: 'Optional', 'aria-invalid': list.nameError ? 'true' : null, 'aria-describedby': msgId, value, onchange: (e) => actions.setMe(e.target.value) }),
    ),
    h(
      'div',
      { id: msgId, class: 'field-msg', 'aria-live': 'polite' },
      list.nameError ? h('p', { class: 'roster-error', role: 'alert', text: list.nameError }) : null,
      list.nameConflict
        ? h(
            'div',
            { class: 'claim-prompt', role: 'alert' },
            h('p', { class: 'roster-error', text: "That's a saved player \u2014 is it you?" }),
            h(
              'div',
              { class: 'roster-row' },
              h('button', { type: 'button', class: 'btn btn-green btn-small', 'data-fk': 'username-claim', onclick: actions.claimAsMe, text: `Yes, I'm ${list.nameConflict}` }),
              h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'username-claim-cancel', onclick: actions.cancelClaim, text: 'No' }),
            ),
          )
        : null,
      !list.nameError && !list.nameConflict ? h('p', { class: 'roster-notice', text: 'Optional. Added to links you share.' }) : null,
    ),
  );
}

function rosterSection(state, actions) {
  const { list } = state;
  const open = list.rosterOpen;
  return h(
    'section',
    { class: `panel roster${open ? ' is-open' : ''}`, 'aria-label': 'You' },
    h(
      'button',
      { type: 'button', class: 'roster-toggle', 'data-fk': 'roster-toggle', 'aria-expanded': String(open), 'aria-controls': 'roster-body', onclick: actions.toggleRoster },
      h('span', { class: 'panel-title', text: 'You' }),
      h('span', { class: 'own-chevron', 'aria-hidden': 'true', text: '\u25be' }),
    ),
    open
      ? h(
          'div',
          { class: 'roster-body', id: 'roster-body' },
          usernameField(state, actions),
          h(
            'div',
            { class: 'roster-row' },
            h('input', { type: 'text', class: 'roster-field', readonly: true, 'data-fk': 'roster-code', 'aria-label': 'Your roster code', value: actions.rosterCode(), onfocus: (e) => e.target.select() }),
            h('button', { type: 'button', class: `btn btn-green${list.copy === 'copied' ? ' is-done' : ''}`, 'data-fk': 'roster-copy', onclick: actions.copyRoster, text: list.copy === 'copied' ? 'Copied' : list.copy === 'failed' ? 'Copy failed' : 'Copy' }),
          ),
          h(
            'form',
            { class: 'roster-row', onsubmit: (e) => (e.preventDefault(), actions.importRoster(e.target.elements.roster.value)) },
            h('input', { type: 'text', name: 'roster', class: 'roster-field', 'data-fk': 'roster-import', 'aria-label': 'Paste a roster code', placeholder: 'Paste a roster code', autocomplete: 'off', spellcheck: 'false', 'aria-invalid': list.error ? 'true' : null, 'aria-describedby': list.error ? 'roster-error' : null, value: list.draft }),
            h('button', { type: 'submit', class: 'btn btn-grey', 'data-fk': 'roster-import-btn', text: 'Import' }),
          ),
          list.error ? h('p', { class: 'roster-error', id: 'roster-error', role: 'alert', text: list.error }) : null,
          list.notices.map((n) => h('p', { class: 'roster-notice', role: 'status', text: n })),
        )
      : null,
  );
}

function classesView(state, actions) {
  const { classes } = state.data;
  const { list, store, build } = state;
  const f = list.filter.trim().toLowerCase();
  const visible = list.editing ? classes : ownedClasses(classes, store.owned, build.base ? [build.base.slug] : []);
  const rows = visible.filter((c) => c.name.toLowerCase().includes(f)).sort((a, b) => a.tier - b.tier);
  return h(
    'main',
    { class: 'classes' },
    h(
      'div',
      { class: 'classes-side' },
      rosterSection(state, actions),
      h(
        'section',
        { class: 'panel classes-panel', 'aria-label': 'Classes' },
        h(
          'div',
          { class: 'panel-head' },
          h('h2', { class: 'panel-title', text: 'Classes' }),
          h(
            'div',
            { class: 'head-actions' },
            build.base || state.visitor ? h('button', { type: 'button', class: 'btn btn-green btn-small jump-loadout', 'data-fk': 'jump-loadout', onclick: actions.jumpToLoadout, text: 'Loadout' }) : null,
            h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'list-edit', 'aria-pressed': String(list.editing), onclick: () => actions.setEditing(!list.editing), text: list.editing ? 'Done' : 'Edit' }),
          ),
        ),
        h(
          'div',
          { class: 'list-controls' },
          h('input', { type: 'search', class: 'picker-filter', 'data-fk': 'list-filter', 'aria-label': 'Filter classes', placeholder: 'Filter classes', value: list.filter, oninput: (e) => actions.setListFilter(e.target.value) }),
        ),
        rows.length
          ? h('ul', { class: 'own-list' }, rows.map((c) => ownRow(state, actions, c)))
          : h('p', { class: 'empty', text: !list.editing && !store.hasAny() ? "You haven't marked any classes yet. Tap Edit to add some." : 'No classes match' }),
      ),
    ),
    loadout(state, actions),
  );
}

function chip(cls, level, unowned) {
  return h('li', { class: 'chip', 'data-level': level }, h('span', { class: 'chip-level', text: String(level) }), h('span', { class: 'chip-name', text: cls.name }), unowned ? notOwned() : null);
}

function cardEditor(state, actions, i) {
  const { classes } = state.data;
  const build = state.team.builds[i];
  const owned = state.team.owned[i];
  // A card with an imported roster lists only what that roster owns, plus its selected items.
  const choices = owned ? ownedClasses(classes, owned, build.base ? [build.base.slug] : []) : classes;
  return h(
    'div',
    { class: 'card-editor' },
    h(
      'select',
      { class: 'slot-select', 'data-fk': `team-${i}-base`, 'aria-label': `Player ${i + 1} base class`, onchange: (e) => actions.setTeamBase(i, e.target.value || null) },
      h('option', { value: '', text: 'Choose base class' }),
      choices.map((c) => h('option', { value: c.slug, selected: build.base?.slug === c.slug, text: c.name })),
    ),
    build.base
      ? passivePicker(state, actions, {
          base: build.base,
          slots: build.slots,
          has: (code, n) => (owned?.[code] ?? 0) >= n,
          ownedOnly: Boolean(owned),
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
  if (!active || !root.contains(active)) return null;
  const text = active.type === 'text' || active.type === 'search';
  return { key: active.getAttribute('data-fk'), start: text ? active.selectionStart : null, end: text ? active.selectionEnd : null };
}

function restoreFocus(root, saved) {
  if (!saved?.key) return;
  const next = [...root.querySelectorAll('[data-fk]')].find((el) => el.getAttribute('data-fk') === saved.key);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (next.type === 'search') next.setSelectionRange(next.value.length, next.value.length);
  else if (next.type === 'text' && saved.start != null) next.setSelectionRange(saved.start, saved.end);
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
    state.view === 'team' ? teamView(state, actions) : classesView(state, actions),
  );
  if (state.copy === 'failed') root.querySelector('.copy-fallback')?.select();
  else restoreFocus(root, key);
}
