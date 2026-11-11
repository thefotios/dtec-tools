import { ownedClasses } from './owned.mjs';
import { nameProblem, playerByName, sameName, ownedBase, MAX_MEMBERS } from './players.mjs';
import { savedSlots, diffSets, MAX_PASSIVES } from './passives.mjs';
import { sameSlot } from './router.mjs';
import { h, hidden } from './dom.mjs';
import { classIcon } from './icons.mjs';
import { buildEffectsPanel, teamMatrix, teamInputs } from './render-effects.mjs';
import { importSection } from './render-import.mjs';

// Renders from state only; all data text goes through textContent.
// Interactive elements carry data-fk so focus survives the full re-render.

const TAG_LABEL = { team: 'TEAM', master: 'MASTER' };
const SVG_NS = 'http://www.w3.org/2000/svg';

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

// "New here? See Help" pointer shown inside first-run empty states.
function helpLink(actions) {
  return h('p', { class: 'help-pointer' }, 'New here? ', h('a', { class: 'visitor-team-link', 'data-fk': 'help-link', href: new URL('help', document.baseURI).href, onclick: (e) => (e.preventDefault(), actions.setView('help')), text: 'See Help' }));
}

// "No saved players yet" sentence pointing at the Builds page import.
const noPlayersHint = (actions) => [
  'No saved players yet. Import a link or code on the ',
  h('a', { class: 'visitor-team-link', 'data-fk': 'open-import', href: new URL('.', document.baseURI).href, onclick: (e) => (e.preventDefault(), actions.openImport()), text: 'Builds page' }),
  '.',
];

function navButton(state, actions, view, text) {
  const current = state.view === view;
  return h('button', { type: 'button', class: `btn ${current ? 'btn-green' : 'btn-grey'}`, 'data-fk': `nav-${view}`, 'aria-current': current ? 'page' : null, onclick: () => actions.setView(view), text });
}

const notOwned = () => h('span', { class: 'not-owned', text: 'Not owned' });
const newTag = () => h('span', { class: 'level-tag state-tag tag-new', text: 'NEW' });
const noClassesText = (player) => `${player.name || 'This player'} has no classes.`;
const originalTag = () => h('span', { class: 'level-tag state-tag tag-original', text: 'ORIGINAL' });


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
      navButton(state, actions, 'builds', 'Builds'),
      navButton(state, actions, 'team', 'Team'),
      navButton(state, actions, 'help', 'Help'),
    ),
  );
}

// The class levels the Builds page shows: the viewed player's, else mine.
const levelsOf = (state) => (state.viewing ? state.viewing.player.levels : state.store.owned);

// One class in the list. Outside edit mode rows stay closed and tapping a row selects it as the base; in edit mode rows expand independently.
function ownRow(state, actions, cls) {
  const { store } = state;
  const max = levelsOf(state)[cls.code] ?? 0;
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
        classIcon(cls),
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
// opts: { noTitle (omit the heading), levels (owned levels by class code; levelRows only), unknownRoster (omit the "Not owned" pill: no roster to judge by), original(code, level) (saved passive that is not selected: tagged ORIGINAL), levelRows (render owned classes as ownership-style level rows; locked levels shown gray unless unlockedOnly), unlockedOnly, onUnlockedOnly, base, slots, has(code, level), ownedOnly (list only owned levels, plus selected), emptyText (shown when ownedOnly leaves nothing), flag(code, level), filter, filterKey, keyPrefix, label, onFilter, onToggle, onClear }
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
  const original = (c, n) => !picked(c, n) && Boolean(opts.original?.(c.code, n));
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
        'aria-label': `${c.name} level ${n}${original(c, n) ? ', original' : ''}`,
        onclick: () => (blocked ? null : opts.onToggle(c, n)),
      },
      h('span', { class: 'cell-badge' }, on ? h('span', { class: 'cell-check', 'aria-hidden': 'true', text: '\u2713' }) : null, h('span', { class: 'level-num', text: String(n) })),
      h('span', { class: 'level-text', text: c.levels[n - 1].text }),
      original(c, n) ? originalTag() : null,
      opts.flag(c.code, n) ? notOwned() : null,
    );
  };
  // Ownership-style row: all levels written out; locked levels (above the owned max) are gray and not selectable.
  const levelRow = (c) => {
    const max = opts.levels[c.code] ?? 0;
    return h(
      'li',
      { class: 'own-row passive-own', 'data-class': c.slug },
      h(
        'div',
        { class: 'own-head' },
        h('span', { class: 'own-toggle passive-own-name' }, classIcon(c, { size: 24 }), h('span', { class: 'class-name', text: c.name }), diamonds(c, tiers)),
        max ? h('span', { class: 'own-pill is-owned', 'data-level': max }, `L${max}`, hidden(` owned, level ${max}`)) : opts.unknownRoster ? null : notOwned(),
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
                  'aria-label': `${c.name} level ${n}${locked ? ', locked' : ''}${original(c, n) ? ', original' : ''}`,
                  onclick: () => (blocked ? null : opts.onToggle(c, n)),
                },
                levelChip(c.levels[n - 1], n - 1),
                h('span', { class: 'level-text', text: c.levels[n - 1].text }),
                original(c, n) ? originalTag() : null,
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
    h('input', { type: 'search', class: 'picker-filter', 'data-fk': opts.filterKey, 'aria-label': 'Filter passives by class', placeholder: 'Filter passives', value: opts.filter, oninput: (e) => opts.onFilter(e.target.value) }),
    rows.length
      ? h(
          'ul',
          { class: opts.levelRows ? 'own-list' : 'passive-rows' },
          rows.map((c) =>
            opts.levelRows ? levelRow(c) : h(
              'li',
              { class: 'passive-row', 'data-class': c.slug },
              h('div', { class: 'passive-name' }, classIcon(c, { size: 24 }), h('span', { class: 'class-name', text: c.name }), diamonds(c, tiers)),
              h('div', { class: 'passive-cells' }, visibleLevels(c).map((n) => cell(c, n))),
            ),
          ),
        )
      : h('p', { class: 'empty', text: !f && opts.ownedOnly && opts.emptyText ? opts.emptyText : 'No passives match' }),
  );
}

// diff is the viewed player's saved-vs-current passive diff, null for me.
function pickerEditor(state, actions, diff) {
  const { store, viewing } = state;
  const levels = levelsOf(state);
  const roster = viewing ? passiveOwned(viewing.player, viewing.hasRoster) : levels;
  // A viewed player known only by their base has no roster: every other class's levels 1-3 count as unlocked.
  const has = viewing ? (code, n) => (roster ? (roster[code] ?? 0) >= n : n <= 3) : (code, n) => store.has(code, n);
  return passivePicker(state, actions, {
    noTitle: true,
    base: state.build.base,
    slots: state.build.slots,
    levels,
    unknownRoster: Boolean(viewing && !roster),
    has,
    original: diff ? (code, n) => diff.removed.some((s) => s.cls.code === code && s.level === n) : null,
    ownedOnly: true,
    levelRows: true,
    unlockedOnly: state.passives.unlockedOnly,
    onUnlockedOnly: actions.setUnlockedOnly,
    flag: (code, n) => !has(code, n),
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
// opts.tag marks a changed passive (NEW); opts.key makes the row focusable by a restore action.
function passiveRow(slot, owned, opts = {}) {
  const { cls, level } = slot;
  return h(
    'li',
    { class: 'level passive-read', 'data-level': level, 'data-fk': opts.key ?? null, tabindex: opts.key ? '-1' : null },
    levelChip(cls.levels[level - 1], level - 1),
    h(
      'span',
      { class: 'level-text' },
      h('span', { class: 'passive-line' }, h('span', { class: 'row-from' }, classIcon(cls, { size: 24 }), cls.name, !owned || (owned[cls.code] ?? 0) >= level ? null : notOwned(), opts.tag ?? null), h('span', { text: cls.levels[level - 1].text })),
    ),
  );
}

// A saved passive removed in the experiment: a dimmed button that puts it back while a slot is free.
function ghostRow(slot, full, actions) {
  const { cls, level } = slot;
  return h(
    'li',
    { class: 'passive-ghost-item' },
    h(
      'button',
      {
        type: 'button',
        class: `level passive-read passive-ghost${full ? ' is-disabled' : ''}`,
        'data-level': level,
        'data-fk': `ghost-${cls.slug}-${level}`,
        'aria-disabled': full ? 'true' : null,
        'aria-describedby': full ? 'ghost-hint' : null,
        'aria-label': `Restore ${cls.name} level ${level}, original, removed`,
        onclick: () => (full ? null : actions.restoreSlot(cls.slug, level)),
      },
      levelChip(cls.levels[level - 1], level - 1),
      h('span', { class: 'level-text' }, h('span', { class: 'passive-line' }, h('span', { class: 'row-from' }, classIcon(cls, { size: 24 }), cls.name, originalTag()), h('span', { text: cls.levels[level - 1].text }))),
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

// The selected class's five levels; with actions (my own build) its header carries the share buttons.
function basePanel(state, base, owned, actions = null) {
  const title = h('h2', { class: 'panel-title' }, classIcon(base), h('span', { text: base.name }), diamonds(base, state.data.tiers), (owned[base.code] ?? 0) > 0 ? null : notOwned());
  const shareBlock = actions ? actions.shareBlock() : null;
  return h(
    'section',
    { class: 'panel base-levels', 'aria-label': `${base.name} levels` },
    actions
      ? h(
          'div',
          { class: 'panel-head' },
          title,
          h(
            'div',
            { class: 'head-actions' },
            copyButton(state, actions, { key: 'copy', done: 'copied', idle: 'Copy link', doneText: 'Link copied', primary: true, block: shareBlock, onclick: actions.copyLink }),
            copyButton(state, actions, { key: 'copy-code', done: 'code-copied', idle: 'Copy code', doneText: 'Code copied', primary: false, block: shareBlock, onclick: actions.copyCode }),
          ),
        )
      : title,
    actions ? copyFeedback(state, shareBlock) : null,
    levelList(base, owned),
  );
}

// A player record with only its base level has no roster to judge passives against, unless a shared link spelled the roster out.
const passiveOwned = (player, explicit = false) => (explicit || Object.keys(player.levels).length > 1 ? player.levels : null);

function visitorNameError(state) {
  const v = state.viewing.link;
  const name = v.nameDraft.trim();
  if (!name) return 'Enter a name to save this build';
  return nameProblem(name, state.players.me);
}

// Banner, name field, and save button for another player's opened link.
function visitorBanner(state, actions) {
  const v = state.viewing.link;
  const error = visitorNameError(state);
  const name = v.nameDraft.trim();
  const isSaved = v.saved && sameName(name, v.savedName);
  const existing = !error && state.players.get(name);
  const shown = v.error ?? (v.nameDraft ? error : null);
  return h(
    'section',
    { class: 'panel visitor-banner', 'aria-label': 'Shared build' },
    h('h2', { class: 'panel-title', text: v.incoming.name ? `${v.incoming.name}'s build` : 'Shared build' }),
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

function loadout(state, actions) {
  const { viewing } = state;
  const { base, slots } = state.build;
  const banner = viewing?.link ? visitorBanner(state, actions) : null;
  if (!base) {
    const empty = h('section', { class: 'panel loadout', id: 'loadout', 'aria-label': 'Loadout' }, h('p', { class: 'empty', text: viewing ? noClassesText(viewing.player) : 'Pick a class to see its loadout.' }));
    return banner ? h('div', { class: 'loadout-col' }, banner, empty) : empty;
  }
  const editing = state.loadoutEditing;
  const owned = levelsOf(state);
  const passiveOwners = viewing ? passiveOwned(viewing.player, viewing.hasRoster) : owned;
  // Experiment diff against the viewed player's saved set; me has none.
  const diff = viewing ? diffSets(savedSlots(state.data.classes, viewing.player, base.code), slots) : null;
  const isNew = (sl) => diff?.added.some((a) => sameSlot(a, sl));
  const full = slots.length >= MAX_PASSIVES;
  return h(
    'div',
    { class: 'loadout-col' },
    banner,
    basePanel(state, base, owned, actions),
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
          diff?.changed ? h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': 'loadout-revert', onclick: actions.revertSlots }, 'Revert', hidden(' passives to saved')) : null,
          h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'loadout-edit', 'aria-pressed': String(editing), onclick: () => actions.setLoadoutEditing(!editing), text: editing ? 'Done' : 'Edit' }),
        ),
      ),
      editing
        ? pickerEditor(state, actions, diff)
        : h(
            'div',
            { class: 'loadout-read' },
            slots.length || diff?.removed.length
              ? h(
                  'ol',
                  { class: 'levels' },
                  slots.map((sl) => passiveRow(sl, passiveOwners, viewing ? { key: `passive-row-${sl.cls.slug}-${sl.level}`, tag: isNew(sl) ? newTag() : null } : {})),
                  diff?.removed.map((sl) => ghostRow(sl, full, actions)),
                )
              : h('p', { class: 'empty', text: viewing ? 'No passives in this build.' : 'No passives yet. Tap Edit to pick up to 3.' }),
            diff?.removed.length && full ? h('p', { id: 'ghost-hint', class: 'ghost-hint', text: 'Remove a passive to restore' }) : null,
          ),
    ),
    buildEffectsPanel(state, base, owned[base.code] ?? 0, slots, { experiment: Boolean(diff?.changed) }),
  );
}

// Viewing select: Me first, then saved players A to Z, with a temporary entry for an unsaved opened link right after Me.
// The link entry's value starts with a unit separator control character, which no player name can contain.
// Option value for the shared-link entry, which has no player name to select by.
const LINK_OPTION = '\u001flink';

function viewingField(state, actions) {
  const { viewing } = state;
  const link = viewing?.source === 'link' ? viewing.link : null;
  const current = !viewing ? '' : link ? LINK_OPTION : viewing.player.name;
  const selected = (v) => (v === current ? true : null);
  const players = [...state.players.players].sort((a, b) => a.name.localeCompare(b.name));
  return h(
    'div',
    { class: 'viewing' },
    h('label', { class: 'field-label', for: 'viewing', text: 'Viewing' }),
    h(
      'select',
      { id: 'viewing', class: 'slot-select', 'data-fk': 'viewing', onchange: (e) => actions.viewPlayer(e.target.value === LINK_OPTION ? '' : e.target.value) },
      h('option', { value: '', selected: selected(''), text: 'Me' }),
      link ? h('option', { value: LINK_OPTION, selected: selected(LINK_OPTION), text: link.incoming.name || 'Shared link' }) : null,
      players.map((p) => h('option', { value: p.name, selected: selected(p.name), text: p.name })),
    ),
    viewing?.source === 'library'
      ? h('button', { type: 'button', class: 'btn btn-red btn-small viewing-remove', 'data-fk': 'viewing-remove', onclick: actions.removeViewed }, 'Remove', hidden(` ${viewing.player.name} from library`))
      : null,
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
            h('input', { type: 'text', id: 'username', name: 'username', class: 'roster-field', 'data-fk': 'username', autocomplete: 'off', spellcheck: 'false', maxlength: '40', placeholder: 'Optional', 'aria-invalid': list.nameError ? 'true' : null, 'aria-describedby': msgId, value: list.nameDraft ?? me, oninput: (e) => actions.setNameDraft(e.target.value) }),
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
  return h('section', { class: 'panel roster', 'aria-label': 'You' }, usernameField(state, actions), viewingField(state, actions), importSection(state, actions));
}

function classesView(state, actions) {
  const { classes } = state.data;
  const { list, store, build } = state;
  const f = list.filter.trim().toLowerCase();
  const visible = list.editing ? classes : ownedClasses(classes, levelsOf(state), build.base ? [build.base.slug] : []);
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
            build.base ? h('button', { type: 'button', class: 'btn btn-green btn-small jump-loadout', 'data-fk': 'jump-loadout', onclick: actions.jumpToLoadout, text: 'Loadout' }) : null,
            state.viewing ? null : h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'list-edit', 'aria-pressed': String(list.editing), onclick: () => actions.setEditing(!list.editing), text: list.editing ? 'Done' : 'Edit' }),
          ),
        ),
        h(
          'div',
          { class: 'list-controls' },
          h('input', { type: 'search', class: 'picker-filter', 'data-fk': 'list-filter', 'aria-label': 'Filter classes', placeholder: 'Filter classes', value: list.filter, oninput: (e) => actions.setListFilter(e.target.value) }),
        ),
        rows.length
          ? h('ul', { class: 'own-list' }, rows.map((c) => ownRow(state, actions, c)))
          : h('p', { class: 'empty', text: state.viewing && !f ? noClassesText(state.viewing.player) : !list.editing && !store.hasAny() ? "You haven't marked any classes yet. Tap Edit to add some." : 'No classes match' }),
        !rows.length && !state.viewing && !list.editing && !store.hasAny() ? helpLink(actions) : null,
      ),
    ),
    loadout(state, actions),
  );
}

// Pieces shared by library rows and the team matrix.
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
    h('span', { class: 'player-base' }, base ? [classIcon(base, { size: 24 }), `${base.name} L${player.levels[base.code]}`] : 'No classes'),
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
  const players = state.players.players;
  return h(
    'section',
    { class: 'panel library', 'aria-label': 'Players' },
    h('h2', { class: 'panel-title', text: 'Players' }),
    h(
      'ul',
      { class: 'player-list' },
      meRow(state, actions),
      players.map((p) => libraryRow(state, actions, p, { me: false })),
    ),
    players.length
      ? null
      : h(
          'p',
          { class: 'empty' },
          noPlayersHint(actions),
        ),
    players.length ? null : helpLink(actions),
  );
}

// Team matrix header: name, class select and remove for my team; name and class text for a link.
function memberHeader(state, actions, { name, player, base }, { readOnly }) {
  const isMe = Boolean(state.players.me) && sameName(state.players.me, name);
  const title = h('span', { class: 'member-name', text: isMe ? `${name} (you)` : name });
  if (readOnly) return [title, base ? h('span', { class: 'member-base' }, classIcon(base, { size: 24 }), h('span', { text: base.name }), diamonds(base, state.data.tiers)) : h('span', { class: 'card-empty', text: 'No classes owned' })];
  const k = `member-${name.toLowerCase()}`;
  const owned = state.data.classes.filter((c) => (player.levels[c.code] ?? 0) > 0);
  return [
    title,
    owned.length
      ? h(
          'span',
          { class: 'member-base' },
          base ? classIcon(base, { size: 24 }) : null,
          h(
            'select',
            { class: 'slot-select', 'data-fk': `${k}-base`, 'aria-label': `${name} class`, onchange: (e) => actions.setMemberBase(name, e.target.value) },
            owned.map((c) => h('option', { value: c.code, selected: base?.code === c.code, text: `${c.name} (L${player.levels[c.code]})` })),
          ),
        )
      : h('span', { class: 'card-empty', text: 'No classes owned' }),
    h('button', { type: 'button', class: 'btn btn-red btn-small', 'data-fk': `${k}-remove`, onclick: () => actions.removeMember(name) }, 'Remove', hidden(` ${name} from team`)),
  ];
}

// The "+" header cell: a native select listing me (with an owned class) and saved players not on the team.
function teamAddSelect(state, actions, team, mePlayer) {
  const onTeam = new Set(team.members.map((m) => m.name.toLowerCase()));
  const candidates = [
    ...(state.players.me && Object.keys(mePlayer.levels).length ? [mePlayer] : []),
    ...state.players.players,
  ].filter((p) => !onTeam.has(p.name.toLowerCase()));
  const full = team.members.length >= MAX_MEMBERS;
  const disabled = full || !candidates.length;
  const reason = full ? 'Team is full (8)' : 'All players added';
  return {
    nobody: !candidates.length,
    el: h(
      'select',
      { class: 'slot-select matrix-add-select', 'data-fk': 'team-add', 'aria-label': 'Add player', title: disabled ? reason : 'Add player', disabled, onchange: (e) => actions.addMember(e.target.value) },
      h('option', { value: '', text: disabled ? reason : '+' }),
      disabled ? null : candidates.map((p) => h('option', { value: p.name, text: p.name })),
    ),
  };
}

function teamPanel(state, actions, members) {
  const team = state.players.team;
  const me = actions.mePlayer();
  const teamBlock = actions.teamShareBlock();
  const add = teamAddSelect(state, actions, team, me);
  const empty = h(
    'p',
    { class: 'empty' },
    add.nobody
      ? noPlayersHint(actions)
      : 'Add players with the + column to see who contributes which effects',
  );
  return h(
    'section',
    { class: 'panel team-panel', 'aria-label': 'Team' },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', { class: 'panel-title', text: `Team (${team.members.length}/${MAX_MEMBERS})` }),
      h(
        'div',
        { class: 'head-actions' },
        copyButton(state, actions, { key: 'copy', done: 'copied', idle: 'Copy team link', doneText: 'Link copied', primary: true, block: teamBlock, onclick: actions.copyLink }),
      ),
    ),
    copyFeedback(state, teamBlock),
    h(
      'div',
      { class: 'team-controls' },
      h('label', { class: 'field-label', for: 'team-name', text: 'Team name' }),
      h('input', { type: 'text', id: 'team-name', class: 'roster-field', 'data-fk': 'team-name', autocomplete: 'off', maxlength: '40', value: team.name, oninput: (e) => actions.setTeamNameDraft(e.target.value), onchange: (e) => actions.renameTeam(e.target.value) }),
    ),
    teamMatrix(state, teamInputs(state, members), members.map((m) => memberHeader(state, actions, m, { readOnly: false })), { add: add.el, empty }),
  );
}

// What replacing my team does, in words: it replaces a non-empty team, and updates every linked player (other than me) already saved.
function replaceText(state, link) {
  const me = state.players.me;
  const updates = link.members.some(({ name }) => !(me && sameName(name, me)) && state.players.get(name));
  const replaces = state.players.team.members.length > 0;
  const tail = 'saved players with the classes, levels and passives in this link';
  return `This ${replaces ? `replaces your team${updates ? ` and updates ${tail}` : ''}` : `updates ${tail}`}. Continue?`;
}

// The "Replace my team" action and its inline confirm; an equal link shows "This is your team" instead.
function replaceControls(state, actions, mine) {
  const link = state.team.link;
  if (mine) {
    return h(
      'div',
      { class: 'claim-prompt', role: 'status' },
      h('p', { class: 'field-msg', text: 'This is your team' }),
      h('div', { class: 'roster-row' }, h('button', { type: 'button', class: 'btn btn-green btn-small', 'data-fk': 'open-my-team', onclick: actions.openMyTeam, text: 'Open my team' })),
    );
  }
  if (link.confirming) {
    return h(
      'div',
      { class: 'claim-prompt', role: 'alert' },
      h('p', { class: 'roster-error', text: replaceText(state, link) }),
      h(
        'div',
        { class: 'roster-row' },
        h('button', { type: 'button', class: 'btn btn-green btn-small', 'data-fk': 'replace-yes', onclick: actions.confirmReplaceTeam, text: 'Yes' }),
        h('button', { type: 'button', class: 'btn btn-grey btn-small', 'data-fk': 'replace-no', onclick: actions.cancelReplaceTeam, text: 'No' }),
      ),
    );
  }
  return null;
}

// An opened team link: the read-only matrix and a Replace my team action. Nothing is imported until confirmed.
function teamLinkView(state, actions) {
  const link = state.team.link;
  const classes = state.data.classes;
  const same = actions.linkIsMyTeam();
  const members = link.members.map(({ name, player }) => ({ name, player, base: classes.find((c) => c.code === player.base) ?? null }));
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
          same ? null : h('button', { type: 'button', class: 'btn btn-green', 'data-fk': 'replace-team', disabled: !link.members.length, onclick: actions.replaceTeamFromLink, text: 'Replace my team' }),
          copyButton(state, actions, { key: 'copy', done: 'copied', idle: 'Copy link', doneText: 'Link copied', primary: false, block: null, onclick: actions.copyLink, small: false }),
        ),
      ),
      copyFeedback(state, null),
      replaceControls(state, actions, same),
      link.members.length
        ? teamMatrix(state, teamInputs(state, members), members.map((m) => memberHeader(state, actions, m, { readOnly: true })))
        : h('p', { class: 'empty', text: 'No valid players in this link.' }),
    ),
  );
}

function teamView(state, actions) {
  if (state.team.link) return teamLinkView(state, actions);
  const team = state.players.team;
  const me = actions.mePlayer();
  const members = team.members.flatMap((m) => {
    const player = playerByName(state.players, me, m.name);
    return player ? [{ name: player.name, player, base: memberBase(state, player, m.base) }] : [];
  });
  return h('main', { class: 'team' }, teamPanel(state, actions, members), libraryPanel(state, actions));
}

const HELP_SAMPLE = 'c5-sc1sal23-D5XB8XG5XD';

function helpView(state) {
  const section = (title, ...body) => h('section', { class: 'panel help-panel', 'aria-label': title }, h('h2', { class: 'panel-title', text: title }), ...body);
  const code = (text) => h('code', { text });
  return h(
    'main',
    { class: 'help' },
    section(
      'Getting started',
      h(
        'ol',
        { class: 'help-list' },
        h('li', {}, 'Open Builds and tap Edit in the Classes list. Mark the classes you own and unlock their levels. Levels are cumulative: unlocking level 3 unlocks levels 1 and 2.'),
        h('li', {}, 'Tap Done, then tap a class to make it your base class.'),
        h('li', {}, 'In the base class passives panel, tap Edit and pick up to 3 passives (levels 1 to 3). You can only pick levels you have unlocked, and a class can never be its own passive. Each class keeps its own set of passives.'),
      ),
    ),
    section(
      'Sharing your build',
      h('p', {}, 'Set a username in the You panel first. Then use the buttons on the base class panel:'),
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, h('strong', { text: 'Copy link' }), ' shares everything: your build, your classes, your username, and the passives for every class. Best for Discord and similar.'),
        h('li', {}, h('strong', { text: 'Copy code' }), ' is a short code that fits in Roblox chat, such as ', code(HELP_SAMPLE), '.'),
      ),
      h('p', {}, 'Opening someone else\'s link shows their build read-only. Tap Save to players to keep them.'),
      h('p', {}, 'To bring your own build onto another device, paste your link or code into Import link or code on Builds. It restores your classes and passives.'),
    ),
    section(
      'Importing',
      h('p', {}, 'The Import link or code box in the You panel on Builds takes a share link, a build code, a bare roster code or a team link. Here is what each one does:'),
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, 'Your own link or code updates your build. If that would replace classes or passives you already have, you confirm first. A full link replaces all your passive sets; a code replaces only the passives of its base class unless it carries the other sets.'),
        h('li', {}, 'Another player\'s link or code is saved to your players at once, with a View button. Pasting the same player again updates them.'),
        h('li', {}, 'A code with no name asks Whose build is this? Choose Mine to update your build (this also sets your username if you have none), or Save as to keep it under a name.'),
        h('li', {}, 'A bare roster code, the letters after the last dash, replaces only the classes you own.'),
        h('li', {}, 'A team link opens that team on the Team page. Nothing is saved until you tap Replace my team.'),
      ),
    ),
    section(
      'Players and team',
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, 'The Team page holds one team of up to 8 players, with a name you can edit. Below it, the Players list shows you and every saved player; Remove deletes a player from your library and the team.'),
        h('li', {}, 'In the team table, each player is a column. The class select in the column header lists the classes that player owns, and Remove takes them off the team. The + column adds a player; with a saved player it uses their saved class.'),
        h('li', {}, 'Passives can\'t be changed on the Team page, because re-rolling costs in game. Each column uses the passives that player saved for the selected class.'),
        h('li', {}, 'Copy team link shares the team. Opening a team link shows its table read-only. Tap Replace my team to use it (you confirm first when your team has players), or This is your team when it already matches. Replacing also updates your saved players\' class, level and passives for that class.'),
        h('li', {}, 'On Builds, the Viewing select in the You panel shows a saved player\'s classes and passives read-only.'),
        h('li', {}, 'While viewing a player, you can try other passives. New picks are tagged NEW and the saved ones stay as ORIGINAL rows; Revert restores them. Experiments are never saved, and the Team page keeps the saved passives.'),
      ),
    ),
    section(
      'Combined effects',
      h('p', {}, 'The Combined effects panel on the Builds page adds up everything your unlocked base levels and chosen passives give. The same stat from different sources adds together, grouped by category with a list of where each part comes from. Level 4 team bonuses also count for you.'),
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, h('strong', { text: 'rounded' }), ': a Recruit level 5 build scales passive values by 1.25 and rounds each one to 1 decimal, so the total may be off by a little.'),
        h('li', {}, h('strong', { text: 'stacking unconfirmed' }), ': the stat comes from more than one copy of the same class, and it is not known whether those copies add up.'),
        h('li', {}, h('strong', { text: 'Conditional' }), ': bonuses that only apply in a situation, such as while driving. They are totaled per situation and never added to the main totals.'),
        h('li', {}, h('strong', { text: 'Nearby' }), ': bonuses that are higher when players are close together. They are listed without a total.'),
        h('li', {}, h('strong', { text: 'Flags' }), ': on or off abilities with no number.'),
        h('li', {}, h('strong', { text: 'Uncertain' }), ': effects whose exact behavior is not confirmed yet, listed under the open question and left out of totals.'),
      ),
      h('p', {}, 'The team table on the Team page uses the same grouping with one column per player, so you can see who contributes what.'),
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, 'Each row is an effect with a tag: self applies to that player only, team is a level 4 bonus for the whole team, nearby applies when players are close together.'),
        h('li', {}, 'A player\'s column shows what their selected class gives for that effect. An empty cell means they do not contribute.'),
        h('li', {}, 'The Team total column adds up the team rows that have a number. Self, nearby and uncertain rows have no total.'),
        h('li', {}, 'A row marked ×N is shared by N players, which shows where skills overlap.'),
        h('li', {}, 'Recruit at level 5 scales passive values by 1.25; a note under the table says when that applies.'),
      ),
    ),
    section(
      'Reading a code',
      h('p', {}, code(HELP_SAMPLE), ' breaks down like this:'),
      h(
        'ul',
        { class: 'help-list' },
        h('li', {}, code('c5'), ': base class Crafter at level 5.'),
        h('li', {}, code('sc1sal23'), ': passives, each a class code plus its levels: Scout 1, Salvager 2, Salvager 3. Levels of one class share its code, so sal23 is sal2sal3.'),
        h('li', {}, code('D5XB8XG5XD'), ': the classes you own, one symbol per class in list order. The symbol is the highest level unlocked and a number repeats it.'),
      ),
      h('p', {}, 'Class codes:'),
      h(
        'table',
        { class: 'code-table' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Code' }), h('th', { scope: 'col', text: 'Class' }))),
        h('tbody', {}, state.data.classes.map((c) => h('tr', {}, h('td', {}, code(c.code)), h('td', { text: c.name })))),
      ),
    ),
    section('Your data', h('p', {}, 'Everything is stored in this browser only. Nothing is uploaded, and clearing site data removes it. Nothing syncs between devices: on a new device, paste your own link or code into Import link or code on Builds to restore your classes and passives.')),
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
    state.view === 'help' ? helpView(state) : state.view === 'team' ? teamView(state, actions) : classesView(state, actions),
  );
  if (state.copyFocus) {
    state.copyFocus = false;
    root.querySelector('.copy-fallback')?.select();
  } else restoreFocus(root, key);
}
