import { ownedClasses } from './owned.mjs';
import { isValidName, playerByName, sameName, ownedBase, NAME_RULE, MAX_MEMBERS } from './players.mjs';
import { toSlots, MAX_PASSIVES } from './passives.mjs';

// Renders from state only; all data text goes through textContent.
// Interactive elements carry data-fk so focus survives the full re-render.

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


function copyButton(state, actions, { key, done, idle, doneText, primary, block, onclick, small = true }) {
  const isDone = state.copy === done;
  return h('button', { type: 'button', class: `btn ${primary ? 'btn-green' : 'btn-grey'}${small ? ' btn-small' : ''}${isDone ? ' is-done' : ''}`, 'data-fk': key, disabled: Boolean(block), 'aria-describedby': block ? 'share-hint' : null, onclick, text: isDone ? doneText : idle });
}

// Feedback shared by every copy action: a hint when sharing is unavailable, a live status, and a selectable field when the clipboard fails.
function copyFeedback(state, block) {
  return [
    block ? h('p', { class: 'share-hint', id: 'share-hint', text: block }) : null,
    h('span', { class: 'visually-hidden', role: 'status', text: state.copy === 'copied' ? 'Link copied' : state.copy === 'code-copied' ? 'Code copied' : '' }),
    state.copy === 'failed'
      ? h('input', { type: 'text', class: 'copy-fallback', readonly: true, 'aria-label': 'Text to copy', 'data-fk': 'link-field', value: state.copyText, onfocus: (e) => e.target.select() })
      : null,
  ];
}

function header(state, actions) {
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
  const full = slots.length >= MAX_PASSIVES;
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
      opts.noTitle ? null : h('h2', { class: 'panel-title', text: `Passives (${slots.length}/${MAX_PASSIVES})` }),
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
      h('span', { class: 'passive-line' }, h('span', { class: 'row-from' }, cls.name, !owned || (owned[cls.code] ?? 0) >= level ? null : notOwned()), h('span', { text: cls.levels[level - 1].text })),
    ),
  );
}

// A class's five levels, unlocked ones in color and locked ones dimmed.
function levelList(base, owned) {
  return h(
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
  );
}

// The selected class's five levels.
function basePanel(state, base, owned) {
  return h(
    'section',
    { class: 'panel base-levels', 'aria-label': `${base.name} levels` },
    h('h2', { class: 'panel-title' }, h('span', { text: base.name }), diamonds(base, state.data.tiers), (owned[base.code] ?? 0) > 0 ? null : notOwned()),
    levelList(base, owned),
  );
}

// A player record with only its base level has no roster to judge passives against.
const passiveOwned = (player) => (Object.keys(player.levels).length > 1 ? player.levels : null);

function visitorNameError(state) {
  const v = state.visitor;
  const name = v.nameDraft.trim();
  if (!name) return 'Enter a name to save this build';
  if (!isValidName(name)) return NAME_RULE;
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
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title', text: `${base.name} passives (${slots.length}/${MAX_PASSIVES})` })),
      h('div', { class: 'loadout-read' }, slots.length ? h('ol', { class: 'levels' }, slots.map((sl) => passiveRow(sl, passiveOwned(player)))) : h('p', { class: 'empty', text: 'No passives in this build.' })),
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
  const shareBlock = actions.shareBlock();
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
        h('h2', { class: 'panel-title', text: `${base.name} passives (${slots.length}/${MAX_PASSIVES})` }),
        h(
          'div',
          { class: 'head-actions' },
          copyButton(state, actions, { key: 'copy', done: 'copied', idle: 'Copy link', doneText: 'Link copied', primary: true, block: shareBlock, onclick: actions.copyLink }),
          copyButton(state, actions, { key: 'copy-code', done: 'code-copied', idle: 'Copy code', doneText: 'Code copied', primary: false, block: shareBlock, onclick: actions.copyCode }),
          h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'loadout-edit', 'aria-pressed': String(editing), onclick: () => actions.setLoadoutEditing(!editing), text: editing ? 'Done' : 'Edit' }),
        ),
      ),
      copyFeedback(state, shareBlock),
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

// Username: a saved name shows as text with an Edit button; otherwise (or while editing) the input saves on Save or Enter.
// An invalid name shows an inline error, a saved player's name asks for confirmation.
function usernameField(state, actions) {
  const { list } = state;
  const me = state.players.me;
  const editing = list.nameEditing || !me || list.nameDraft != null;
  const msgId = 'username-msg';
  const save = (form) => actions.setMe(form.elements.username.value);
  return h(
    'div',
    { class: 'username' },
    editing
      ? h(
          'form',
          { class: 'username-form', onsubmit: (e) => (e.preventDefault(), save(e.target)), onkeydown: (e) => (e.key === 'Escape' && me ? (e.preventDefault(), actions.cancelEditUsername()) : null) },
          h('label', { class: 'field-label', for: 'username', text: 'Username' }),
          h(
            'div',
            { class: 'roster-row' },
            h('input', { type: 'text', id: 'username', name: 'username', class: 'roster-field', 'data-fk': 'username', autocomplete: 'off', spellcheck: 'false', maxlength: '40', placeholder: 'Optional', 'aria-invalid': list.nameError ? 'true' : null, 'aria-describedby': msgId, value: list.nameDraft ?? me }),
            h('button', { type: 'submit', class: 'btn btn-green btn-small', 'data-fk': 'username-save', text: 'Save' }),
            me ? h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'username-cancel', onclick: actions.cancelEditUsername, text: 'Cancel' }) : null,
          ),
        )
      : h(
          'div',
          { class: 'identity-row' },
          h('span', { class: 'field-label', text: 'Username' }),
          h('span', { class: 'identity-name', 'data-fk': 'username-text', text: me }),
          h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'username-edit', 'aria-label': 'Edit username', onclick: actions.editUsername, text: '\u270e' }),
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
      !me && !list.nameError && !list.nameConflict ? h('p', { class: 'roster-notice', text: 'Optional. Added to links you share.' }) : null,
    ),
  );
}

function rosterSection(state, actions) {
  const { list } = state;
  const open = list.rosterOpen;
  return h(
    'section',
    { class: 'panel roster', 'aria-label': 'You' },
    usernameField(state, actions),
    h(
      'button',
      { type: 'button', class: `roster-toggle${open ? ' is-open' : ''}`, 'data-fk': 'roster-toggle', 'aria-expanded': String(open), 'aria-controls': 'roster-body', onclick: actions.toggleRoster },
      h('span', { class: 'field-label', text: 'Import roster' }),
      h('span', { class: 'own-chevron', 'aria-hidden': 'true', text: '\u25be' }),
    ),
    open
      ? h(
          'div',
          { class: 'roster-body', id: 'roster-body' },
          h(
            'form',
            { class: 'roster-row', onsubmit: (e) => (e.preventDefault(), actions.importRoster(e.target.elements.roster.value)) },
            h('input', { type: 'text', name: 'roster', class: 'roster-field', 'data-fk': 'roster-import', 'aria-label': 'Paste a roster code', placeholder: 'Paste a roster code', autocomplete: 'off', spellcheck: 'false', 'aria-invalid': list.error ? 'true' : null, 'aria-describedby': list.error ? 'roster-error' : null, value: list.draft }),
            h('button', { type: 'submit', class: 'btn btn-grey', 'data-fk': 'roster-import-btn', text: 'Import' }),
          ),
        )
      : null,
    h(
      'div',
      { class: 'field-msg', 'aria-live': 'polite' },
      list.error ? h('p', { class: 'roster-error', id: 'roster-error', role: 'alert', text: list.error }) : null,
      list.notices.map((n) => h('p', { class: 'roster-notice', text: n })),
    ),
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

// Pieces shared by library rows and team cards.
function memberBase(state, player, stored) {
  const code = ownedBase(state.data.classes, player, stored);
  return state.data.classes.find((c) => c.code === code) ?? null;
}

function libraryRow(state, actions, player, { me }) {
  const base = memberBase(state, player, player.base);
  const sets = Object.keys(player.sets).length;
  const marker = me ? 'live' : Object.keys(player.levels).length > 1 ? 'roster' : 'code';
  return h(
    'li',
    { class: `player-row${me ? ' is-me' : ''}`, 'data-player': player.name },
    h('span', { class: 'player-name', text: me ? `${player.name} (you)` : player.name }),
    h('span', { class: 'player-base', text: base ? `${base.name} L${player.levels[base.code]}` : 'No classes' }),
    h('span', { class: 'player-marker', text: marker }),
    h('span', { class: 'player-sets', text: `${sets} ${sets === 1 ? 'set' : 'sets'}` }),
    me ? null : h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': `player-${player.name.toLowerCase()}-remove`, onclick: () => actions.removePlayer(player.name) }, 'Remove', hidden(` ${player.name} from library`)),
  );
}

function meRow(state, actions) {
  if (state.players.me) return libraryRow(state, actions, playerByName(state.players, actions.mePlayer(), state.players.me), { me: true });
  return h(
    'li',
    { class: 'player-row is-me' },
    h('span', { class: 'player-name', text: 'Me' }),
    h('a', { class: 'player-setname', 'data-fk': 'set-username', href: new URL('.', document.baseURI).href, onclick: (e) => (e.preventDefault(), actions.openUsername()), text: 'Set your username' }),
  );
}

function libraryPanel(state, actions) {
  const { paste } = state.team;
  const players = state.players.players;
  return h(
    'section',
    { class: 'panel library', 'aria-label': 'Players' },
    h('h2', { class: 'panel-title', text: 'Players' }),
    h(
      'form',
      { class: 'paste-form', onsubmit: (e) => (e.preventDefault(), actions.pastePlayer(e.target.elements.text.value, e.target.elements.name.value)) },
      h('label', { class: 'field-label', for: 'paste-text', text: 'Player link or code' }),
      h('input', { type: 'text', id: 'paste-text', name: 'text', class: 'roster-field', 'data-fk': 'paste-text', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste a link, path, or code', 'aria-invalid': paste.error ? 'true' : null, 'aria-describedby': 'paste-msg', value: paste.draft }),
      h('label', { class: 'field-label', for: 'paste-name', text: 'Player name' }),
      h(
        'div',
        { class: 'roster-row' },
        h('input', { type: 'text', id: 'paste-name', name: 'name', class: 'roster-field', 'data-fk': 'paste-name', autocomplete: 'off', spellcheck: 'false', maxlength: '40', placeholder: 'Needed when the link has no username', value: paste.name }),
        h('button', { type: 'submit', class: 'btn btn-green', 'data-fk': 'paste-add', text: 'Add player' }),
      ),
      h(
        'div',
        { id: 'paste-msg', class: 'field-msg', 'aria-live': 'polite' },
        paste.error ? h('p', { class: 'roster-error', role: 'alert', text: paste.error }) : null,
        paste.message ? h('p', { class: 'visitor-saved', text: paste.message }) : null,
        paste.notices.map((n) => h('p', { class: 'roster-notice', text: n })),
      ),
    ),
    h(
      'ul',
      { class: 'player-list' },
      meRow(state, actions),
      players.map((p) => libraryRow(state, actions, p, { me: false })),
    ),
    players.length ? null : h('p', { class: 'empty', text: 'Paste a link to add players' }),
  );
}

// One player card: name, class, that class's five levels per the player's levels, and read-only passives.
function playerCard(state, actions, { name, player, base, controls }) {
  const slots = base ? toSlots(state.data.classes, player.sets[base.code] ?? []) : [];
  const owned = passiveOwned(player);
  return h(
    'li',
    { class: 'team-card', 'data-player': name },
    h('h3', { class: 'card-name', text: name }),
    controls?.select ?? (base ? h('p', { class: 'card-base' }, h('span', { class: 'card-base-name', text: base.name }), diamonds(base, state.data.tiers)) : null),
    base ? levelList(base, player.levels) : h('p', { class: 'card-empty', text: 'No classes owned' }),
    base
      ? slots.length
        ? h('ol', { class: 'levels' }, slots.map((sl) => passiveRow(sl, owned)))
        : h('p', { class: 'card-empty', text: 'No passives saved' })
      : null,
    controls?.actions ?? null,
  );
}

function teamCard(state, actions, member, me) {
  const player = playerByName(state.players, me, member.name);
  if (!player) return null;
  const base = memberBase(state, player, member.base);
  const owned = state.data.classes.filter((c) => (player.levels[c.code] ?? 0) > 0);
  const k = `member-${member.name.toLowerCase()}`;
  return playerCard(state, actions, {
    name: player.name,
    player,
    base,
    controls: {
      select: h(
        'select',
        { class: 'slot-select', 'data-fk': `${k}-base`, 'aria-label': `${player.name} class`, onchange: (e) => actions.setMemberBase(player.name, e.target.value) },
        owned.map((c) => h('option', { value: c.code, selected: base?.code === c.code, text: `${c.name} (L${player.levels[c.code]})` })),
      ),
      actions: h('div', { class: 'card-actions' }, h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': `${k}-remove`, onclick: () => actions.removeMember(player.name) }, 'Remove from team', hidden(` ${player.name}`))),
    },
  });
}

function addPlayerSelect(state, actions, team, mePlayer) {
  const onTeam = new Set(team.members.map((m) => m.name.toLowerCase()));
  const candidates = [
    ...(state.players.me && Object.keys(mePlayer.levels).length ? [mePlayer] : []),
    ...state.players.players,
  ].filter((p) => !onTeam.has(p.name.toLowerCase()));
  const full = team.members.length >= MAX_MEMBERS;
  const disabled = full || !candidates.length;
  return h(
    'div',
    { class: 'team-add' },
    h('label', { class: 'field-label', for: 'team-add', text: 'Add player' }),
    h(
      'select',
      { id: 'team-add', class: 'slot-select', 'data-fk': 'team-add', disabled, onchange: (e) => actions.addMember(e.target.value) },
      h('option', { value: '', text: full ? 'Team is full (8)' : candidates.length ? 'Choose a player' : 'All players added' }),
      disabled ? null : candidates.map((p) => h('option', { value: p.name, text: p.name })),
    ),
  );
}

function teamPanel(state, actions) {
  const teams = state.players.teams;
  const team = teams.find((t) => t.id === state.players.active) ?? null;
  const me = actions.mePlayer();
  const teamBlock = actions.teamShareBlock();
  return h(
    'section',
    { class: 'panel team-panel', 'aria-label': 'Team' },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', { class: 'panel-title', text: team ? `Team (${team.members.length}/${MAX_MEMBERS})` : 'Team' }),
      h(
        'div',
        { class: 'head-actions' },
        copyButton(state, actions, { key: 'copy', done: 'copied', idle: 'Copy team link', doneText: 'Link copied', primary: true, block: teamBlock, onclick: actions.copyLink }),
        h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'team-new', onclick: actions.createTeam, text: 'New' }),
      ),
    ),
    copyFeedback(state, teamBlock),
    team
      ? [
          h(
            'div',
            { class: 'team-controls' },
            h('label', { class: 'field-label', for: 'team-select', text: 'Team' }),
            h('select', { id: 'team-select', class: 'slot-select', 'data-fk': 'team-select', onchange: (e) => actions.setActiveTeam(e.target.value) }, teams.map((t) => h('option', { value: t.id, selected: t.id === team.id, text: t.name || 'Unnamed team' }))),
            h('label', { class: 'field-label', for: 'team-name', text: 'Team name' }),
            h(
              'div',
              { class: 'roster-row' },
              h('input', { type: 'text', id: 'team-name', class: 'roster-field', 'data-fk': 'team-name', autocomplete: 'off', maxlength: '40', value: team.name, onchange: (e) => actions.renameTeam(e.target.value) }),
              h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': 'team-delete', onclick: actions.deleteTeam }, 'Delete', hidden(' team')),
            ),
            addPlayerSelect(state, actions, team, me),
          ),
          team.members.length
            ? h('ul', { class: 'team-grid' }, team.members.map((m) => teamCard(state, actions, m, me)))
            : h('p', { class: 'empty', text: 'Add players from your library' }),
        ]
      : h('p', { class: 'empty', text: 'Create a team to start' }),
  );
}

// An opened team link: read-only cards and a Save team action. Nothing is imported until saved.
function teamLinkView(state, actions) {
  const link = state.team.link;
  const classes = state.data.classes;
  return h(
    'main',
    { class: 'team' },
    h(
      'section',
      { class: 'panel team-panel', 'aria-label': 'Team link' },
      h(
        'div',
        { class: 'panel-head' },
        h('h2', { class: 'panel-title', text: link.name ? `${link.name} (${link.members.length}/${MAX_MEMBERS})` : `Shared team (${link.members.length}/${MAX_MEMBERS})` }),
        h(
          'div',
          { class: 'head-actions' },
          h('button', { type: 'button', class: 'btn btn-green', 'data-fk': 'team-save', disabled: !link.members.length, onclick: actions.saveTeamLink, text: 'Save team' }),
          copyButton(state, actions, { key: 'copy', done: 'copied', idle: 'Copy link', doneText: 'Link copied', primary: false, block: null, onclick: actions.copyLink, small: false }),
        ),
      ),
      copyFeedback(state, null),
      link.members.length
        ? h(
            'ul',
            { class: 'team-grid' },
            link.members.map(({ name, player }) => playerCard(state, actions, { name, player, base: classes.find((c) => c.code === player.base) ?? null })),
          )
        : h('p', { class: 'empty', text: 'No valid players in this link.' }),
    ),
  );
}

function teamView(state, actions) {
  if (state.team.link) return teamLinkView(state, actions);
  return h('main', { class: 'team' }, libraryPanel(state, actions), teamPanel(state, actions));
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
